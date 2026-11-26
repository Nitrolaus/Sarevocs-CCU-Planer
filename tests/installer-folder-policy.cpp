// Local synthetic fixture. Opens an MSI session without running installation actions.
#include "../installer/msi/NativePreflight.cpp"
#include <fstream>
#include <iostream>
#include <functional>

struct PromptState { int answer=IDNO; int count=0; bool safeDefault=true; };
int __stdcall testPrompt(void* raw,UINT message,MSIHANDLE) {
    if((message&0xff000000)!=INSTALLMESSAGE_USER) return 0;
    auto state=static_cast<PromptState*>(raw);
    ++state->count;
    state->safeDefault=state->safeDefault && (message&MB_DEFBUTTON2)==MB_DEFBUTTON2;
    return state->answer;
}
void check(bool value,const char* label) {
    if(!value) throw std::runtime_error(label);
    std::cout<<"PASS: "<<label<<"\n";
}
void rejects(const std::function<void()>& operation,const char* label) {
    bool failed=false;
    try {operation();} catch(const wstring&){failed=true;} catch(const UnsafeFolderPermissions&){failed=true;}
    check(failed,label);
}
void sharedDirectory(const fs::path& path) {
    fs::create_directories(path);
    PSECURITY_DESCRIPTOR raw=nullptr;
    require(ConvertStringSecurityDescriptorToSecurityDescriptorW(
        L"D:P(A;OICI;FA;;;WD)",SDDL_REVISION_1,&raw,nullptr)!=FALSE,L"Fixture security descriptor");
    Local descriptor(raw);
    BOOL present=FALSE,defaulted=FALSE;PACL acl=nullptr;
    require(GetSecurityDescriptorDacl(raw,&present,&acl,&defaulted)!=FALSE && present,L"Fixture ACL");
    require(SetNamedSecurityInfoW(const_cast<wchar_t*>(path.c_str()),SE_FILE_OBJECT,
        DACL_SECURITY_INFORMATION|PROTECTED_DACL_SECURITY_INFORMATION,nullptr,nullptr,acl,nullptr)==ERROR_SUCCESS,L"Fixture ACL write");
}
int wmain(int argc,wchar_t** argv) {
    try {
        if(argc!=3) throw std::runtime_error("Expected fixture directory and read-only MSI input");
        const fs::path area=fs::absolute(argv[1]);
        require(area.wstring().find(L"\\work\\temp\\")!=wstring::npos && !fs::exists(area),L"Fixture must be a new workspace temporary directory");
        fs::create_directories(area);
        auto token=effectiveToken();
        const auto first=area/L"SharedOne",second=area/L"SharedTwo";
        sharedDirectory(first);sharedDirectory(second);
        rejects([&]{verifyTree(first,token.get());},"shared write permissions detected");
        verifyTree(first,token.get(),true);
        check(true,"explicit shared-folder mode still completes structural validation");

        MsiSetInternalUI(INSTALLUILEVEL_NONE,nullptr);
        MSIHANDLE raw=0;
        const wstring msiPath=fs::path(argv[2]).make_preferred().wstring();
        const auto opened=MsiOpenPackageExW(msiPath.c_str(),MSIOPENPACKAGEFLAGS_IGNOREMACHINESTATE,&raw);
        require(opened==ERROR_SUCCESS,L"Cannot open read-only MSI fixture: "+std::to_wstring(opened));
        PMSIHANDLE session=raw;
        setProperty(session,L"REINSTALL",L"ALL");setProperty(session,L"REINSTALLMODE",L"vamus");
        check(wholeReinstall(session),"complete quiet reinstall is accepted");
        setProperty(session,L"REINSTALL",L"Planner");
        check(wholeReinstall(session),"full UI expansion of ALL to the sole Planner feature is accepted");
        setProperty(session,L"REINSTALL",L"Planner,Unknown");
        check(!wholeReinstall(session),"an unknown or partial feature list is rejected");
        setProperty(session,L"REINSTALL",L"");
        check(!wholeReinstall(session),"an unspecified reinstall cannot authorize an update");
        setProperty(session,L"REINSTALL",L"Planner");setProperty(session,L"REINSTALLMODE",L"amus");
        check(!wholeReinstall(session),"a missing package recache flag is still rejected");
        setProperty(session,L"REINSTALLMODE",L"vamus");setProperty(session,L"REMOVE",L"ALL");
        check(!wholeReinstall(session),"a removal cannot masquerade as a complete update");
        setProperty(session,L"REMOVE",L"");
        PromptState prompts;
        INSTALLUI_HANDLER_RECORD previous=nullptr;
        require(MsiSetExternalUIRecord(testPrompt,INSTALLLOGMODE_USER,&prompts,&previous)==ERROR_SUCCESS,L"Cannot attach synthetic MSI UI");
        setProperty(session,L"UILevel",L"2");
        rejects([&]{verifyChosenTree(session,first,token.get());},"quiet install requires explicit folder-specific permission");
        check(prompts.count==0,"quiet install cannot display or accept a hidden risk prompt");
        setProperty(session,L"CCUFOLDERRISKROOT",second.wstring());
        rejects([&]{verifyChosenTree(session,first,token.get());},"permission for another folder does not authorize this target");
        setProperty(session,L"CCUFOLDERRISKROOT",L"");
        setProperty(session,L"UILevel",L"5");
        bool cancelled=false;
        try {verifyChosenTree(session,first,token.get());} catch(const FolderChoiceCancelled&){cancelled=true;}
        check(cancelled && prompts.count==1,"declining the risk cancels before any installer action");
        check(property(session,L"CCUFOLDERRISKROOT").empty(),"declining does not retain permission");
        prompts.answer=IDYES;
        verifyChosenTree(session,first,token.get());
        check(prompts.count==2 && prompts.safeDefault,"affirmative risk approval uses a safe No default");
        check(same(property(session,L"CCUFOLDERRISKROOT"),first.wstring()),"approval is scoped to the selected physical folder");
        verifyChosenTree(session,first,token.get());
        check(prompts.count==2,"rechecking the approved folder does not prompt twice");
        prompts.answer=IDNO;cancelled=false;
        try {verifyChosenTree(session,second,token.get());} catch(const FolderChoiceCancelled&){cancelled=true;}
        check(cancelled && prompts.count==3,"changing folders requires a new decision");
        setProperty(session,L"UILevel",L"2");
        setProperty(session,L"CCUFOLDERRISKROOT",first.wstring());
        const auto file=first/L"payload.txt";
        {std::ofstream output(file);output<<"abc";}
        const KnownFile expected{L"payload.txt",3,"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"};
        verifyDigest(file,expected);
        {std::ofstream output(file);output<<"xyz";}
        rejects([&]{verifyDigest(file,expected);},"a folder opt-in cannot disable payload hash checks");
        const auto link=first/L"linked.txt";
        require(CreateHardLinkW(link.c_str(),file.c_str(),nullptr)!=FALSE,L"Fixture hard link");
        rejects([&]{verifyChosenTree(session,first,token.get());},"approved folders still reject multiply-linked program files");
        fs::remove(link);
        canonical((fs::path(folder(FOLDERID_ProgramFiles,token.get()))/L"CCU_InstallerPathTest").wstring(),token.get());
        check(true,"a Program Files subdirectory is permitted as a path choice");
        rejects([&]{canonical(folder(FOLDERID_ProgramFiles,token.get()),token.get());},"Program Files root cannot become the app directory");
        rejects([&]{canonical((fs::path(folder(FOLDERID_Windows,token.get()))/L"CCU_InstallerPathTest").wstring(),token.get());},"Windows system files remain outside the program target");
        MsiSetExternalUIRecord(previous,0,nullptr,nullptr);
        std::cout<<"PASS: offline installer folder-policy fixture complete\n";
        return 0;
    }catch(const wstring& error){std::wcerr<<error<<"\n";}
    catch(const std::exception& error){std::cerr<<error.what()<<"\n";}
    catch(...){std::cerr<<"Unexpected native fixture failure\n";}
    return 1;
}
