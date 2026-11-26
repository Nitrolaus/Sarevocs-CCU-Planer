// Per-user MSI validation. The only mutations performed here are MSI session properties.
#define NOMINMAX
#define UNICODE
#define _UNICODE
#include <windows.h>
#include <msiquery.h>
#include <aclapi.h>
#include <shlobj.h>
#include <bcrypt.h>
#include <tlhelp32.h>
#include <sddl.h>
#include <wrl/client.h>
#include <filesystem>
#include <algorithm>
#include <array>
#include <set>
#include <memory>
#include <span>
#include <string>
#include <vector>
#include "FileManifest.h"

namespace fs = std::filesystem;
using std::wstring;
using Microsoft::WRL::ComPtr;
constexpr wchar_t legacyRegistration[] = LR"(Software\Sarevoc\SarevocsCCUPlaner)";
constexpr wchar_t registration[] = LR"(Software\Sarevoc\SarevocsCCUPlanerMSI)";
constexpr wchar_t legacyArp[] = LR"(Software\Microsoft\Windows\CurrentVersion\Uninstall\SarevocsCCUPlaner.Selectable)";
constexpr wchar_t receipt[] = L"2026-11-18.2:5438e49d354058b32007d2ed20e189391af6a96150bd9fa7ced6b3823c0e2e73";
constexpr wchar_t appName[] = L"Sarevocs-CCU-Planer.exe";
constexpr wchar_t legacyLinkName[] = L"Sarevoc\u00b4s CCU Planer.lnk";
constexpr wchar_t linkName[] = L"Sarevoc\u00b4s CCU Planer Alpha.lnk";
constexpr wchar_t legacyMarkerGuid[] = L"{A9E970CA-6C7E-44D7-A98E-075C4903CC27}";
constexpr wchar_t markerGuid[] = L"{1BC71A73-24CC-4AC1-BFE9-CCB7B4F36C63}";
constexpr const wchar_t* previousProducts[] = {
    L"{142B7731-1211-4ED2-AE86-C572D7053118}",
    L"{142B7731-1211-4ED2-AE86-C572D7053119}",
    L"{142B7731-1211-4ED2-AE86-C572D7053120}",
    L"{142B7731-1211-4ED2-AE86-C572D7053121}",
};

void require(bool test, const wstring& reason) { if (!test) throw reason; }
bool same(const wstring& a, const wstring& b) {
    return CompareStringOrdinal(a.c_str(),-1,b.c_str(),-1,TRUE) == CSTR_EQUAL;
}
wstring trimSlash(wstring s) { while (s.size()>3 && s.back()==L'\\') s.pop_back(); return s; }
bool within(const wstring& child, const wstring& parent) {
    return same(child,parent) || (child.size()>parent.size() && child[parent.size()]==L'\\' && same(child.substr(0,parent.size()),parent));
}
struct CloseHandleFn { void operator()(void* h) const { if (h && h!=INVALID_HANDLE_VALUE) CloseHandle(h); } };
using Handle = std::unique_ptr<void,CloseHandleFn>;
struct CloseKey { void operator()(HKEY h) const { if(h) RegCloseKey(h); } };
using Key = std::unique_ptr<HKEY__,CloseKey>;
struct LocalFreeFn { void operator()(void* p) const { LocalFree(p); } };
using Local = std::unique_ptr<void,LocalFreeFn>;
struct CoFree { void operator()(wchar_t* p) const { CoTaskMemFree(p); } };

wstring property(MSIHANDLE session, const wchar_t* name, bool directory=false) {
    auto get = directory ? MsiGetTargetPathW : MsiGetPropertyW;
    DWORD size=0; wchar_t dummy=L'\0';
    UINT code=get(session,name,&dummy,&size);
    require(code==ERROR_MORE_DATA || code==ERROR_SUCCESS,L"Cannot read MSI property: "+wstring(name));
    std::vector<wchar_t> value(++size);
    require(get(session,name,value.data(),&size)==ERROR_SUCCESS,L"Cannot read MSI property: "+wstring(name));
    return value.data();
}
void setProperty(MSIHANDLE s,const wchar_t* key,const wstring& value) {
    require(MsiSetPropertyW(s,key,value.c_str())==ERROR_SUCCESS,L"Cannot set MSI property: "+wstring(key));
}
bool wholeReinstall(MSIHANDLE s) {
    if(!same(property(s,L"REINSTALLMODE"),L"vamus") || !property(s,L"REMOVE").empty()) return false;
    const wstring features=property(s,L"REINSTALL");
    if(features==L"ALL") return true;
    if(features!=L"Planner") return false;
    // Full MSI UI expands ALL into installed feature names before the server sequence.
    // Accept Planner only when it is the package's entire feature table.
    PMSIHANDLE database=MsiGetActiveDatabase(s);
    require(database!=0,L"Cannot inspect MSI features.");
    MSIHANDLE rawView=0;
    require(MsiDatabaseOpenViewW(database,L"SELECT `Feature` FROM `Feature`",&rawView)==ERROR_SUCCESS,L"Cannot inspect MSI feature table.");
    PMSIHANDLE view=rawView;
    require(MsiViewExecute(view,0)==ERROR_SUCCESS,L"Cannot read MSI features.");
    MSIHANDLE rawRow=0;
    require(MsiViewFetch(view,&rawRow)==ERROR_SUCCESS,L"MSI feature table is empty.");
    PMSIHANDLE row=rawRow;
    wchar_t name[64]{};DWORD size=64;
    require(MsiRecordGetStringW(row,1,name,&size)==ERROR_SUCCESS,L"Cannot read MSI feature name.");
    MSIHANDLE rawNext=0;const UINT nextCode=MsiViewFetch(view,&rawNext);PMSIHANDLE next=rawNext;
    require(nextCode==ERROR_SUCCESS || nextCode==ERROR_NO_MORE_ITEMS,L"Cannot finish MSI feature inspection.");
    return wstring(name)==L"Planner" && nextCode==ERROR_NO_MORE_ITEMS;
}
Handle effectiveToken() {
    HANDLE raw=nullptr;
    if (!OpenThreadToken(GetCurrentThread(),TOKEN_QUERY|TOKEN_DUPLICATE|TOKEN_IMPERSONATE,TRUE,&raw)) {
        require(GetLastError()==ERROR_NO_TOKEN && OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY|TOKEN_DUPLICATE,&raw),L"Cannot identify caller.");
    }
    return Handle(raw);
}
wstring folder(REFKNOWNFOLDERID id,HANDLE token) {
    PWSTR raw=nullptr;
    require(SUCCEEDED(SHGetKnownFolderPath(id,KF_FLAG_DONT_VERIFY,token,&raw)),L"Cannot resolve current user's folders.");
    std::unique_ptr<wchar_t,CoFree> value(raw);
    return trimSlash(value.get());
}
Key openKey(HKEY base,const wchar_t* path) {
    HKEY result=nullptr;
    auto code=RegOpenKeyExW(base,path,0,KEY_READ|KEY_WOW64_64KEY,&result);
    require(code==ERROR_SUCCESS || code==ERROR_FILE_NOT_FOUND || code==ERROR_PATH_NOT_FOUND,L"Cannot verify HKCU registration.");
    return Key(result);
}
wstring readString(HKEY key,const wchar_t* name) {
    if (!key) return {};
    DWORD size=0,type=0;
    LSTATUS code=RegQueryValueExW(key,name,nullptr,&type,nullptr,&size);
    if(code==ERROR_FILE_NOT_FOUND) return {};
    require(code==ERROR_SUCCESS && type==REG_SZ && size>=sizeof(wchar_t) && size<=65536 && size%2==0,L"Invalid registry value.");
    std::vector<wchar_t> buffer(size/2+1);
    require(RegQueryValueExW(key,name,nullptr,&type,reinterpret_cast<BYTE*>(buffer.data()),&size)==ERROR_SUCCESS &&
            size>=2 && buffer[size/2-1]==0 && wcslen(buffer.data())==size/2-1,L"Invalid registry string.");
    return buffer.data();
}
const KnownCabBuild* findCabBuild(const wstring& version) {
    for(const auto& build:knownCabBuilds) if(version==build.version) return &build;
    return nullptr;
}
const KnownCabBuild& checkLegacyKey(HKEY key,const wstring& root) {
    DWORD subkeys=0,values=0;
    require(RegQueryInfoKeyW(key,nullptr,nullptr,nullptr,&subkeys,nullptr,nullptr,&values,nullptr,nullptr,nullptr,nullptr)==ERROR_SUCCESS &&
            !subkeys && values==9,L"Unknown CAB uninstall registration.");
    const auto* build=findCabBuild(readString(key,L"DisplayVersion"));
    require(build!=nullptr,L"Diese Altversion kann das Setup nicht direkt übernehmen. Aktualisiere den Planer zuerst mit dem offiziellen EXE-Installer 0.3.117.");
    wstring uninstall=L"\""+(fs::path(root)/L"Uninstall.exe").wstring()+L"\"";
    const std::pair<const wchar_t*,wstring> expected[]={
        {L"DisplayName",L"Sarevoc\u00b4s CCU Planer"},{L"DisplayVersion",build->version},{L"Publisher",L"Sarevoc"},
        {L"InstallLocation",root},{L"DisplayIcon",(fs::path(root)/appName).wstring()+L",0"},
        {L"UninstallString",uninstall},{L"QuietUninstallString",uninstall+L" /S"}
    };
    for(const auto& [name,value]:expected) require(readString(key,name)==value,L"CAB uninstall value mismatch: "+wstring(name));
    for(auto name:{L"NoModify",L"NoRepair"}) {
        DWORD value=0,size=sizeof(value);
        require(RegGetValueW(key,nullptr,name,RRF_RT_REG_DWORD,nullptr,&value,&size)==ERROR_SUCCESS && value==1,L"Invalid CAB uninstall flags.");
    }
    return *build;
}
DWORD attributes(const fs::path& path) {
    DWORD a=GetFileAttributesW(path.c_str());
    if(a==INVALID_FILE_ATTRIBUTES) {
        DWORD e=GetLastError();
        require(e==ERROR_FILE_NOT_FOUND || e==ERROR_PATH_NOT_FOUND,L"Path is unreadable: "+path.filename().wstring());
    } else require((a&FILE_ATTRIBUTE_REPARSE_POINT)==0,L"Reparse point: "+path.filename().wstring());
    return a;
}
void rejectReparseParents(fs::path p) {
    for(;;) { attributes(p); if(p==p.root_path()) break; p=p.parent_path(); }
}
Handle openRegular(const fs::path& path) {
    Handle h(CreateFileW(path.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr));
    BY_HANDLE_FILE_INFORMATION info{};
    require(h.get()!=INVALID_HANDLE_VALUE && GetFileInformationByHandle(h.get(),&info) &&
        !(info.dwFileAttributes&(FILE_ATTRIBUTE_REPARSE_POINT|FILE_ATTRIBUTE_DIRECTORY)) && info.nNumberOfLinks==1,
        L"Invalid or multiply linked file: "+path.filename().wstring());
    return h;
}
wstring canonical(const wstring& input,HANDLE token) {
    wstring raw=trimSlash(input);
    require(raw.size()>3 && raw.size()<=180 && ((raw[0]>=L'A'&&raw[0]<=L'Z')||(raw[0]>=L'a'&&raw[0]<=L'z')) &&
        raw[1]==L':' && raw[2]==L'\\' && raw.find_first_of(L"<>/\"|?*",3)==wstring::npos && raw.find(L':',3)==wstring::npos,
        L"Choose an absolute local program directory.");
    size_t start=3;
    while(start<raw.size()) {
        size_t end=raw.find(L'\\',start);
        wstring part=raw.substr(start,end==wstring::npos?end:end-start);
        require(!part.empty() && part.back()!=L' ' && part.back()!=L'.' && std::none_of(part.begin(),part.end(),[](wchar_t c){return c<32;}),
            L"Invalid directory component.");
        wstring stem=part.substr(0,part.find(L'.'));
        bool reserved=same(stem,L"CON")||same(stem,L"NUL")||same(stem,L"AUX")||same(stem,L"PRN");
        if(stem.size()==4 && stem[3]>=L'1' && stem[3]<=L'9') reserved|=same(stem.substr(0,3),L"COM")||same(stem.substr(0,3),L"LPT");
        require(!reserved,L"Reserved directory name.");
        if(end==wstring::npos) break;
        start=end+1;
    }
    fs::path root=raw, existing=root;
    require(GetDriveTypeW(root.root_path().c_str())==DRIVE_FIXED,L"A fixed local drive is required.");
    rejectReparseParents(root);
    std::vector<fs::path> missing;
    while(attributes(existing)==INVALID_FILE_ATTRIBUTES) { missing.push_back(existing.filename());existing=existing.parent_path(); }
    require(attributes(existing)&FILE_ATTRIBUTE_DIRECTORY,L"The program location must be a directory.");
    Handle h(CreateFileW(existing.c_str(),FILE_READ_ATTRIBUTES,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,nullptr,OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS|FILE_FLAG_OPEN_REPARSE_POINT,nullptr));
    wchar_t physical[32768]{};
    DWORD length=h.get()==INVALID_HANDLE_VALUE?0:GetFinalPathNameByHandleW(h.get(),physical,32768,FILE_NAME_NORMALIZED|VOLUME_NAME_DOS);
    require(length>4 && length<32768 && wstring(physical,4)==LR"(\\?\)",L"Cannot verify physical directory.");
    fs::path rebuilt=physical+4;
    for(auto i=missing.rbegin();i!=missing.rend();++i) rebuilt/=*i;
    require(same(trimSlash(rebuilt.wstring()),raw),L"Choose the physical local path.");
    for(auto id:{&FOLDERID_Windows,&FOLDERID_ProgramData,&FOLDERID_RoamingAppData}) {
        wstring protectedPath=folder(*id,token);
        require(!within(raw,protectedPath)&&!within(protectedPath,raw),L"Protected program directory.");
    }
    for(auto id:{&FOLDERID_ProgramFiles,&FOLDERID_ProgramFilesX86}) {
        wstring programs=folder(*id,token);
        require(!within(programs,raw),L"Wähle einen eigenen Unterordner für den CCU-Planer.");
    }
    fs::path local=folder(FOLDERID_LocalAppData,token);
    for(const wchar_t* name:{L"SarevocsCCUPlaner-Daten",L"SarevocsCCUPlaner"}) {
        wstring protectedPath=(local/name).wstring();
        require(!within(raw,protectedPath)&&!within(protectedPath,raw),L"Protected planner data directory.");
    }
    return raw;
}

wstring suggestedFolder(HANDLE token) {
    return (fs::path(folder(FOLDERID_Profile,token))/L"CCU_Planer").wstring();
}

struct UnsafeFolderPermissions { wstring message; };
struct FolderChoiceCancelled {};
void verifyTree(const fs::path& root,HANDLE token,bool acceptShared=false);

bool unsafeLegacyFolder(const wstring& root,HANDLE token) {
    try { verifyTree(root,token); }
    catch (const UnsafeFolderPermissions&) { return true; }
    return false;
}

struct MsiInstall {
    wstring code, version, root;
};

MsiInstall registeredMsi(const wstring& code,const wchar_t* markerComponent) {
    wchar_t marker[1024]{},version[32]{};
    DWORD size=static_cast<DWORD>(std::size(marker)),versionSize=static_cast<DWORD>(std::size(version));
    const auto state=MsiGetComponentPathW(code.c_str(),markerComponent,marker,&size);
    require((state==INSTALLSTATE_LOCAL || state==INSTALLSTATE_ABSENT) && same(fs::path(marker).filename().wstring(),L"install-product.txt"),
        L"Der registrierte MSI-Programmordner konnte nicht geprüft werden.");
    require(MsiGetProductInfoW(code.c_str(),INSTALLPROPERTY_VERSIONSTRING,version,&versionSize)==ERROR_SUCCESS,
        L"Die installierte MSI-Version konnte nicht geprüft werden.");
    return {code,version,fs::path(marker).parent_path().wstring()};
}

MsiInstall upgradeSource(MSIHANDLE s) {
    wstring found;
    for(const auto code:previousProducts) {
        if(MsiQueryProductStateW(code)!=INSTALLSTATE_DEFAULT) continue;
        require(found.empty(),L"Mehrere ältere MSI-Installationen gefunden.");
        found=code;
    }
    require(same(found,property(s,L"WIX_UPGRADE_DETECTED")),L"Die gefundene MSI-Installation konnte nicht eindeutig geprüft werden.");
    return found.empty()?MsiInstall{}:registeredMsi(found,same(found,previousProducts[3])?markerGuid:legacyMarkerGuid);
}

std::span<const KnownFile> installedFiles(const MsiInstall& installation) {
    if(same(installation.code,previousProducts[3])) {
        if(installation.version==L"0.3.121") return msi121;
        if(installation.version==L"0.3.122") return msi122;
        if(installation.version==L"0.3.123") return msi123;
        if(installation.version==L"0.3.124") return msi124;
        if(installation.version==L"0.3.125") return msi125;
        if(installation.version==L"0.3.126") return msi126;
        if(installation.version==L"0.3.127") return msi127;
        if(installation.version==L"0.3.128") return msi128;
        if(installation.version==L"0.3.129") return msi129;
        throw wstring(L"Unerwartete installierte Programmversion.");
    }
    if(installation.version==L"0.3.118" && same(installation.code,previousProducts[0])) return msi118;
    if(installation.version==L"0.3.119" && (same(installation.code,previousProducts[0]) || same(installation.code,previousProducts[1]))) return msi119;
    if(installation.version==L"0.3.120") return msi120;
    throw wstring(L"Unerwartete installierte Programmversion.");
}

void prepareUi(MSIHANDLE s) {
    auto token=effectiveToken();
    HKEY current=nullptr;
    require(RegOpenCurrentUser(KEY_READ,&current)==ERROR_SUCCESS,L"Die Windows-Benutzereinstellungen sind nicht lesbar.");
    Key user(current), product=openKey(current,legacyRegistration), arp=openKey(current,legacyArp);
    const auto msi=upgradeSource(s);
    wstring previous=msi.root.empty()?readString(product.get(),L"InstallLocation"):msi.root;
    if(previous.empty()) previous=readString(arp.get(),L"InstallLocation");
    const bool update=!previous.empty();
    wstring target=update?trimSlash(previous):suggestedFolder(token.get());
    wstring version=property(s,L"ProductVersion");
    wstring previousVersion=msi.version.empty()?readString(arp.get(),L"DisplayVersion"):msi.version;
    setProperty(s,L"CcuRoot",target+L"\\");
    setProperty(s,L"CcuUiTitle",update?L"Update installieren":L"Planer installieren");
    setProperty(s,L"CcuUiBanner",update?L"CcuSetupBannerUpdate":L"CcuSetupBannerFresh");
    setProperty(s,L"CcuUiButton",update?L"Update installieren":L"Installieren");
    setProperty(s,L"CcuUiVersion",update&&!previousVersion.empty()?L"Version "+previousVersion+L" \u2192 "+version:L"Version "+version);
    setProperty(s,L"CcuUiHint",update?L"Dein bisheriger Programmordner ist vorausgewählt.":L"Wähle einen leeren Programmordner.");
    setProperty(s,L"CCUACCEPTTERMS",L"");
    setProperty(s,L"CCUUIREQUESTED",L"1");
}

void resolveRoot(MSIHANDLE s) {
    require(property(s,L"ALLUSERS").empty() && property(s,L"RollbackDisabled").empty() && property(s,L"DISABLEROLLBACK").empty(),
        L"Per-user installation with transaction rollback is required.");
    auto token=effectiveToken();
    bool installed=!property(s,L"Installed").empty();
    const auto msi=installed?registeredMsi(property(s,L"ProductCode"),markerGuid):upgradeSource(s);
    const bool modernSource=!msi.root.empty() && same(msi.code,previousProducts[3]);
    HKEY current=nullptr;
    require(RegOpenCurrentUser(KEY_READ,&current)==ERROR_SUCCESS,L"Cannot read user's registry.");
    Key user(current), product=openKey(current,(installed||modernSource)?registration:legacyRegistration), arp=openKey(current,legacyArp);
    if(!installed && !modernSource) {
        Key own=openKey(current,registration);
        require(readString(own.get(),L"InstallLocation").empty(),L"Die neue MSI-Registrierung ist bereits vorhanden.");
    }
    wstring registered=readString(product.get(),L"InstallLocation"), terms=readString(product.get(),L"TermsAcceptance");
    wstring choice=property(s,L"CCUINSTALLDIR"), previous;
    if(!msi.root.empty()) previous=msi.root;
    else if (arp) {
        previous=readString(arp.get(),L"InstallLocation");
        require(!previous.empty(),L"Der Programmordner der vorhandenen Installation fehlt.");
    }
    if(!previous.empty()) previous=canonical(previous,token.get());
    require(registered.empty() || same(registered,previous),L"Die Einträge zum bisherigen Programmordner widersprechen sich.");
    const bool accepted=property(s,L"CCUACCEPTTERMS")==L"1";
    const bool fullUi=property(s,L"CCUUIREQUESTED")==L"1";
    require(installed || accepted || (!fullUi && terms==receipt),L"Bestätige zuerst die Nutzungsbedingungen.");
    wstring legacyVersion;
    if(arp) {
        require(msi.root.empty(),L"Conflicting MSI and CAB registrations.");
        legacyVersion=checkLegacyKey(arp.get(),previous).version;
    }
    else require(!msi.root.empty() || registered.empty(),L"Unrecognized previous installation.");
    require(!product || !msi.root.empty() || arp || terms.empty() || terms==receipt,L"Unrecognized product registration.");
    wstring root=choice.empty() ? previous : canonical(choice,token.get());
    if(root.empty()) root=canonical(suggestedFolder(token.get()),token.get());
    if(!installed && !msi.root.empty() && !same(root,previous)) {
        require(!within(previous,root) && !within(root,previous),L"Wähle einen Programmordner außerhalb des bisherigen Ordners.");
        require(accepted,L"Bestätige die Nutzungsbedingungen für den Ordnerwechsel.");
    }
    if(!installed) require(property(s,L"REINSTALL").empty() && property(s,L"REMOVE").empty(),
        L"Öffne die neue MSI direkt. Für dieses Versionsupdate werden keine REINSTALL-Parameter benötigt.");
    const bool moving=arp && !same(previous,root);
    const bool keepLegacy=arp && moving && unsafeLegacyFolder(previous,token.get());
    require(!installed || same(previous,root),L"Die vorhandene MSI-Installation verwendet ihren registrierten Programmordner.");
    if(moving) {
        require(!within(root,previous) && !within(previous,root),L"Wähle einen Programmordner außerhalb des bisherigen Ordners.");
        require(accepted,L"Bestätige die Nutzungsbedingungen für den Ordnerwechsel.");
    }
    setProperty(s,L"CcuLegacy",arp?L"1":L"");
    setProperty(s,L"CcuLegacyVersion",legacyVersion);
    setProperty(s,L"CcuLegacyMoved",moving?L"1":L"");
    setProperty(s,L"CcuLegacyKeepFiles",keepLegacy?L"1":L"");
    setProperty(s,L"CcuOldNormalizedRoot",(arp||!msi.root.empty())?previous:root);
    setProperty(s,L"CcuLegacyRoot",(arp&&!keepLegacy?previous:root)+L"\\");
    setProperty(s,L"CcuNormalizedRoot",root);
    setProperty(s,L"CcuRoot",root+L"\\");
    setProperty(s,L"ARPINSTALLLOCATION",root);
}

constexpr DWORD replaceRights=DELETE|FILE_DELETE_CHILD|WRITE_DAC|WRITE_OWNER|FILE_WRITE_ATTRIBUTES|FILE_WRITE_EA;
constexpr DWORD changeRights=replaceRights|FILE_WRITE_DATA|FILE_APPEND_DATA;
wstring sidText(PSID sid) {
    LPWSTR raw=nullptr;
    require(IsValidSid(sid) && ConvertSidToStringSidW(sid,&raw),L"Invalid security principal.");
    Local guard(raw);
    return raw;
}
bool trusted(PSID sid,PSID user) {
    return EqualSid(sid,user) || IsWellKnownSid(sid,WinBuiltinAdministratorsSid) || IsWellKnownSid(sid,WinLocalSystemSid) ||
        sidText(sid)==L"S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
}
void verifyAccess(const fs::path& p,PSID user,DWORD directMask,bool checkInheritance,bool acceptShared=false) {
    PSECURITY_DESCRIPTOR security=nullptr;PACL dacl=nullptr;PSID owner=nullptr;
    DWORD error=GetNamedSecurityInfoW(p.c_str(),SE_FILE_OBJECT,OWNER_SECURITY_INFORMATION|DACL_SECURITY_INFORMATION,
        &owner,nullptr,&dacl,nullptr,&security);
    Local guard(security);
    require(error==ERROR_SUCCESS && owner && IsValidSid(owner) && (!dacl || IsValidAcl(dacl)),
        L"Die Ordnerrechte konnten nicht gelesen werden: "+p.wstring());
    if(!acceptShared && (!dacl || !trusted(owner,user)))
        throw UnsafeFolderPermissions{L"Die Eigentümer- oder Zugriffsrechte erlauben weiteren Konten Änderungen: "+p.wstring()};
    if(!dacl) return;
    for(WORD n=0;n<dacl->AceCount;++n) {
        void* entry=nullptr;
        require(GetAce(dacl,n,&entry)!=FALSE,L"Cannot inspect path ACL.");
        auto header=static_cast<ACE_HEADER*>(entry);
        if(header->AceType==ACCESS_DENIED_ACE_TYPE || header->AceType==ACCESS_DENIED_OBJECT_ACE_TYPE) continue;
        if(header->AceType!=ACCESS_ALLOWED_ACE_TYPE) {
            if(!acceptShared) throw UnsafeFolderPermissions{L"Die Zugriffsregeln dieses Ordners sind nicht vollständig bewertbar: "+p.wstring()};
            continue;
        }
        auto ace=static_cast<ACCESS_ALLOWED_ACE*>(entry);
        PSID sid=&ace->SidStart;
        if(trusted(sid,user) || sidText(sid)==L"S-1-3-4") continue;
        DWORD rights=ace->Mask;
        GENERIC_MAPPING mapping{FILE_GENERIC_READ,FILE_GENERIC_WRITE,FILE_GENERIC_EXECUTE,FILE_ALL_ACCESS};
        MapGenericMask(&rights,&mapping);
        bool direct=!(header->AceFlags&INHERIT_ONLY_ACE) && (rights&directMask);
        bool inherited=checkInheritance && (header->AceFlags&(CONTAINER_INHERIT_ACE|OBJECT_INHERIT_ACE)) &&
            (rights&changeRights) && !IsWellKnownSid(sid,WinCreatorOwnerSid);
        if(!acceptShared && (direct||inherited)) throw UnsafeFolderPermissions{L"Andere Windows-Konten dürfen hier Änderungen vornehmen: "+p.wstring()};
    }
}
void verifyTree(const fs::path& root,HANDLE token,bool acceptShared) {
    DWORD size=0;
    GetTokenInformation(token,TokenUser,nullptr,0,&size);
    std::vector<BYTE> info(size);
    require(size && GetTokenInformation(token,TokenUser,info.data(),size,&size),L"Cannot verify user identity.");
    PSID user=reinterpret_cast<TOKEN_USER*>(info.data())->User.Sid;
    bool missing=attributes(root)==INVALID_FILE_ATTRIBUTES;
    if(!missing) {
        verifyAccess(root,user,changeRights,true,acceptShared);
        for(const auto& entry:fs::recursive_directory_iterator(root)) {
            DWORD attr=attributes(entry.path());
            require(attr!=INVALID_FILE_ATTRIBUTES,L"Directory changed during validation.");
            bool directory=(attr&FILE_ATTRIBUTE_DIRECTORY)!=0;
            if(!directory) openRegular(entry.path());
            verifyAccess(entry.path(),user,changeRights,directory,acceptShared);
        }
    }
    for(auto p=root.parent_path(); ;p=p.parent_path()) {
        if(attributes(p)!=INVALID_FILE_ATTRIBUTES) {
            bool drive=p==p.root_path();
            verifyAccess(p,user,drive ? (FILE_DELETE_CHILD|WRITE_DAC|WRITE_OWNER) : replaceRights,missing,acceptShared);
            missing=false;
        } else missing=true;
        if(p==p.root_path()) break;
    }
}
void verifyChosenTree(MSIHANDLE s,const fs::path& root,HANDLE token) {
    try { verifyTree(root,token); }
    catch(const UnsafeFolderPermissions& issue) {
        const wstring approved=trimSlash(property(s,L"CCUFOLDERRISKROOT"));
        if(!same(approved,trimSlash(root.wstring()))) {
            require(property(s,L"UILevel")==L"5",
                L"Dieser Programmordner benötigt eine bewusste Freigabe. Starte das MSI mit vollständiger Oberfläche oder gib CCUFOLDERRISKROOT für genau diesen Ordner an.");
            PMSIHANDLE message=MsiCreateRecord(2);
            require(message!=0,L"Die Ordnerwarnung konnte nicht angezeigt werden.");
            MsiRecordSetStringW(message,0,
                L"Gewählten Programmordner trotzdem verwenden?\n\n[1]\n\nAndere Windows-Konten können hier Programmdateien verändern. "
                L"Manipulierte Programmdateien könnten beim nächsten Start unter deinem Windows-Konto ausgeführt werden und auch auf deine Hangar- und Sitzungsdaten zugreifen.\n\n"
                L"[2]\n\nMit Ja akzeptierst du dieses Risiko für diesen Ordner.");
            MsiRecordSetStringW(message,1,root.c_str());
            MsiRecordSetStringW(message,2,issue.message.c_str());
            const int answer=MsiProcessMessage(s,INSTALLMESSAGE(INSTALLMESSAGE_USER|MB_YESNO|MB_ICONWARNING|MB_DEFBUTTON2),message);
            if(answer!=IDYES) throw FolderChoiceCancelled{};
            setProperty(s,L"CCUFOLDERRISKROOT",trimSlash(root.wstring()));
        }
        // Continue checking every file and ancestor after consent, including reparse points and links.
        verifyTree(root,token,true);
    }
}
void verifyDigest(const fs::path& p,const KnownFile& expected) {
    Handle file=openRegular(p);
    LARGE_INTEGER length{};
    require(GetFileSizeEx(file.get(),&length) && length.QuadPart==expected.size,L"Product file size mismatch: "+p.filename().wstring());
    BCRYPT_ALG_HANDLE algorithm=nullptr;
    require(BCryptOpenAlgorithmProvider(&algorithm,BCRYPT_SHA256_ALGORITHM,nullptr,0)>=0,L"Cannot initialize SHA-256.");
    struct AlgorithmGuard { BCRYPT_ALG_HANDLE h; ~AlgorithmGuard(){ BCryptCloseAlgorithmProvider(h,0); } } algGuard{algorithm};
    BCRYPT_HASH_HANDLE hash=nullptr;
    require(BCryptCreateHash(algorithm,&hash,nullptr,0,nullptr,0,0)>=0,L"Cannot create SHA-256.");
    struct HashGuard { BCRYPT_HASH_HANDLE h; ~HashGuard(){BCryptDestroyHash(h);} } hashGuard{hash};
    std::vector<BYTE> buffer(128*1024);
    DWORD bytes=0;
    do {
        require(ReadFile(file.get(),buffer.data(),static_cast<DWORD>(buffer.size()),&bytes,nullptr)!=FALSE,L"Cannot read product file.");
        require(!bytes || BCryptHashData(hash,buffer.data(),bytes,0)>=0,L"Cannot hash product file.");
    } while(bytes);
    BYTE digest[32];
    require(BCryptFinishHash(hash,digest,sizeof(digest),0)>=0,L"Cannot finish SHA-256.");
    constexpr char hex[]="0123456789abcdef";
    std::string result;
    for(BYTE b:digest){result.push_back(hex[b>>4]);result.push_back(hex[b&15]);}
    require(result==expected.sha,L"Product file hash mismatch: "+p.filename().wstring());
}
void verifyShortcut(const fs::path& directory,const wchar_t* name,const wstring& root,bool mayExist) {
    fs::path p=directory/name;
    rejectReparseParents(p);
    DWORD attr=attributes(p);
    if(attr==INVALID_FILE_ATTRIBUTES) return;
    require(mayExist && !(attr&FILE_ATTRIBUTE_DIRECTORY),L"Foreign shortcut collision.");
    auto file=openRegular(p);
    HRESULT hr=CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);
    require(SUCCEEDED(hr)||hr==RPC_E_CHANGED_MODE,L"Cannot inspect shell link.");
    struct Apartment { bool uninit;~Apartment(){if(uninit)CoUninitialize();} } apartment{SUCCEEDED(hr)};
    ComPtr<IShellLinkW> link; ComPtr<IPersistFile> persisted;
    require(SUCCEEDED(CoCreateInstance(CLSID_ShellLink,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&link))) &&
        SUCCEEDED(link.As(&persisted)) && SUCCEEDED(persisted->Load(p.c_str(),STGM_READ|STGM_SHARE_DENY_NONE)),L"Unreadable shortcut.");
    wchar_t target[32768]{},args[2048]{};
    require(SUCCEEDED(link->GetPath(target,32768,nullptr,SLGP_RAWPATH)) && SUCCEEDED(link->GetArguments(args,2048)) &&
        !args[0] && same(target,(fs::path(root)/appName).wstring()),L"Foreign shortcut target.");
}
void verifyFiles(const fs::path& root,std::span<const KnownFile> expected,std::span<const KnownFile> other,bool mayBeMissing) {
    std::set<wstring> names;
    for(const auto& f:expected) {
        names.emplace(f.path);auto path=root/f.path;
        if(mayBeMissing && attributes(path)==INVALID_FILE_ATTRIBUTES) continue;
        verifyDigest(path,f);
    }
    for(const auto& f:other) if(!names.count(f.path))
        require(attributes(root/f.path)==INVALID_FILE_ATTRIBUTES,L"Foreign file collision: "+wstring(f.path));
}
enum class PlannerState { unreadable, running, stopped };

PlannerState plannerState() {
    Handle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0));
    PROCESSENTRY32W process{};
    process.dwSize=sizeof(process);
    if(snapshot.get()==INVALID_HANDLE_VALUE || !Process32FirstW(snapshot.get(),&process))
        return PlannerState::unreadable;
    do {
        if(same(process.szExeFile,appName)) return PlannerState::running;
    } while(Process32NextW(snapshot.get(),&process));
    return GetLastError()==ERROR_NO_MORE_FILES?PlannerState::stopped:PlannerState::unreadable;
}

void checkPlannerBeforeUpdate(MSIHANDLE s) {
    const auto state=plannerState();
    setProperty(s,L"CcuPlannerReady",state==PlannerState::stopped?L"1":L"");
    const bool unreadable=state==PlannerState::unreadable;
    setProperty(s,L"CcuPlannerTitle",L"Bitte CCU-Planer schließen");
    setProperty(s,L"CcuPlannerHint",unreadable?
        L"Das Setup konnte laufende Prozesse nicht prüfen. Beende den Planer im Windows-Infobereich und klicke auf „Erneut prüfen“.":
        L"Klicke unten rechts im Windows-Infobereich mit der rechten Maustaste auf das Planer-Symbol und wähle „Beenden“. Das X kann den Planer im Hintergrund weiterlaufen lassen.");
}

void verifyOwnership(MSIHANDLE s) {
    auto token=effectiveToken();
    wstring root=property(s,L"CcuNormalizedRoot");
    const wstring oldRoot=property(s,L"CcuOldNormalizedRoot");
    const bool legacy=property(s,L"CcuLegacy")==L"1", installed=!property(s,L"Installed").empty();
    const bool moving=property(s,L"CcuLegacyMoved")==L"1";
    const bool keepLegacy=property(s,L"CcuLegacyKeepFiles")==L"1";
    const auto previousMsi=installed?MsiInstall{}:upgradeSource(s);
    const bool msiUpgrade=!previousMsi.root.empty();
    require(!keepLegacy || (legacy && moving),L"Unexpected request to retain legacy files.");
    require(same(root,trimSlash(property(s,L"CcuRoot",true))),L"Unexpected MSI target.");
    require(same(keepLegacy?root:oldRoot,trimSlash(property(s,L"CcuLegacyRoot",true))),L"Unexpected MSI migration source.");
    wstring desktop=folder(FOLDERID_Desktop,token.get()),menu=(fs::path(folder(FOLDERID_Programs,token.get()))/L"Sarevoc").wstring();
    require(same(desktop,trimSlash(property(s,L"DesktopFolder",true))) && same(menu,trimSlash(property(s,L"CcuMenu",true))),
        L"Unexpected MSI shortcut directory.");
    DWORD attr=attributes(root);
    require(attr==INVALID_FILE_ATTRIBUTES || (attr&FILE_ATTRIBUTE_DIRECTORY),L"Target is a file.");
    const bool sameMsiFolder=msiUpgrade && same(canonical(previousMsi.root,token.get()),root);
    if((!legacy || moving) && !installed && !sameMsiFolder && attr!=INVALID_FILE_ATTRIBUTES)
        require(fs::is_empty(root),L"Wähle einen leeren Programmordner.");
    verifyChosenTree(s,root,token.get());
    if(moving&&!keepLegacy) verifyTree(oldRoot,token.get());
    if(legacy) {
        HKEY current=nullptr;
        require(RegOpenCurrentUser(KEY_READ,&current)==ERROR_SUCCESS,L"Cannot read user's registry.");
        Key user(current), arp=openKey(current,legacyArp);
        require(arp!=nullptr,L"Die registrierte Altinstallation fehlt.");
        const auto& build=checkLegacyKey(arp.get(),oldRoot);
        require(property(s,L"CcuLegacyVersion")==build.version,L"Die Altversion hat sich während des Setups geändert.");
        if(!keepLegacy) verifyFiles(oldRoot,build.files,currentMsiFiles,false);
    }
    if(msiUpgrade) {
        const auto prior=canonical(previousMsi.root,token.get());
        require(same(prior,root) || (!within(prior,root) && !within(root,prior)),L"Die Programmordner dürfen nicht ineinander liegen.");
        verifyChosenTree(s,prior,token.get());
        verifyFiles(prior,installedFiles(previousMsi),currentMsiFiles,false);
        verifyShortcut(desktop,legacyLinkName,prior,true);
        verifyShortcut(menu,legacyLinkName,prior,true);
        verifyShortcut(desktop,linkName,prior,true);
        verifyShortcut(menu,linkName,prior,true);
    }
    if(installed) {
        const auto own=registeredMsi(property(s,L"ProductCode"),markerGuid);
        require(own.version==currentMsiVersion,L"Unerwartete installierte Programmversion.");
        if(!property(s,L"REINSTALL").empty()) require(wholeReinstall(s),L"Eine Reparatur muss alle Programmdateien aus dieser MSI wiederherstellen.");
        verifyFiles(root,currentMsiFiles,cab117,true);
    }
    if(legacy) {
        verifyShortcut(desktop,legacyLinkName,oldRoot,true);
        verifyShortcut(menu,legacyLinkName,oldRoot,true);
    }
    if(!msiUpgrade) {
        verifyShortcut(desktop,linkName,root,installed);
        verifyShortcut(menu,linkName,root,installed);
    }
    const auto state=plannerState();
    require(state!=PlannerState::unreadable,L"Das Setup konnte laufende Prozesse nicht prüfen.");
    require(state==PlannerState::stopped,L"Beende den CCU-Planer unten rechts im Windows-Infobereich über „Beenden“ und starte das Setup erneut.");
}
UINT run(MSIHANDLE s,void(*action)(MSIHANDLE)) noexcept {
    wstring message;
    try {action(s);return ERROR_SUCCESS;}
    catch(const FolderChoiceCancelled&){return ERROR_INSTALL_USEREXIT;}
    catch(const UnsafeFolderPermissions& error){message=error.message;}
    catch(const wstring& error){message=error;}
    catch(...){message=L"Unable to verify installation ownership.";}
    MSIHANDLE record=MsiCreateRecord(1);
    if(record) {
        MsiRecordSetStringW(record,0,L"CCU preflight: [1]");
        MsiRecordSetStringW(record,1,message.c_str());
        MsiProcessMessage(s,INSTALLMESSAGE_INFO,record);
        MsiProcessMessage(s,INSTALLMESSAGE_ERROR,record);
        MsiCloseHandle(record);
    }
    return ERROR_INSTALL_FAILURE;
}
extern "C" __declspec(dllexport) UINT __stdcall ResolveCcuRoot(MSIHANDLE s) {return run(s,resolveRoot);}
extern "C" __declspec(dllexport) UINT __stdcall VerifyCcuOwnership(MSIHANDLE s) {return run(s,verifyOwnership);}
extern "C" __declspec(dllexport) UINT __stdcall PrepareCcuUi(MSIHANDLE s) {return run(s,prepareUi);}
extern "C" __declspec(dllexport) UINT __stdcall CheckCcuPlanner(MSIHANDLE s) {return run(s,checkPlannerBeforeUpdate);}
