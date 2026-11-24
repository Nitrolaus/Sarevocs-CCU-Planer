#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <aclapi.h>
#include <array>
#include <cstdio>
#include <filesystem>
#include <memory>
#include <string_view>
#include <vector>

namespace {
using Path = std::filesystem::path;
struct Failure { const char* operation; DWORD error; };
[[noreturn]] void Fail(const char* operation, DWORD error = GetLastError()) {
    throw Failure{operation, error};
}
struct CloseHandleDeleter { void operator()(void* h) const { CloseHandle(h); } };
struct LocalFreeDeleter { void operator()(void* p) const { LocalFree(p); } };
using Handle = std::unique_ptr<void, CloseHandleDeleter>;
using LocalMemory = std::unique_ptr<void, LocalFreeDeleter>;
constexpr DWORD SharedAccess = FILE_SHARE_READ | FILE_SHARE_WRITE;
constexpr DWORD DirectoryReadAccess = FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES;
constexpr DWORD KeyReadAccess = FILE_READ_DATA | FILE_READ_ATTRIBUTES;
constexpr DWORD ChangeAclAccess = READ_CONTROL | WRITE_DAC;

Handle Open(const Path& path, DWORD access, bool directory, bool allowMissing = false) {
    const auto file = CreateFileW(path.c_str(), access, SharedAccess, nullptr, OPEN_EXISTING,
        FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, nullptr);
    if (file == INVALID_HANDLE_VALUE) {
        const DWORD error = GetLastError();
        if (allowMissing && error == ERROR_FILE_NOT_FOUND) return {};
        Fail(directory ? "open-directory" : "open-key-file", error);
    }
    Handle handle(file);
    BY_HANDLE_FILE_INFORMATION info{};
    if (!GetFileInformationByHandle(file, &info)) Fail("validate-object");
    if ((info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) ||
        bool(info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != directory ||
        (!directory && info.nNumberOfLinks != 1)) Fail("unexpected-object", ERROR_INVALID_DATA);
    return handle;
}

class Rules {
    std::vector<BYTE> tokenInfo;
    std::array<BYTE, SECURITY_MAX_SID_SIZE> systemSid{};
public:
    Rules() {
        HANDLE token{};
        if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) Fail("open-user-token");
        const Handle tokenHandle(token);
        DWORD length{};
        GetTokenInformation(token, TokenUser, nullptr, 0, &length);
        if (!length || GetLastError() != ERROR_INSUFFICIENT_BUFFER) Fail("size-user-sid");
        tokenInfo.resize(length);
        if (!GetTokenInformation(token, TokenUser, tokenInfo.data(), length, &length)) Fail("read-user-sid");
        length = static_cast<DWORD>(systemSid.size());
        if (!CreateWellKnownSid(WinLocalSystemSid, nullptr, systemSid.data(), &length)) Fail("create-system-sid");
    }

    LocalMemory MakeAcl(bool directory) {
        EXPLICIT_ACCESSW entries[2]{};
        PSID sids[] = {User(), systemSid.data()};
        for (size_t index = 0; index < 2; ++index) {
            entries[index].grfAccessPermissions = FILE_ALL_ACCESS;
            entries[index].grfAccessMode = SET_ACCESS;
            entries[index].grfInheritance = directory ? SUB_CONTAINERS_AND_OBJECTS_INHERIT : NO_INHERITANCE;
            BuildTrusteeWithSidW(&entries[index].Trustee, sids[index]);
        }
        PACL acl{};
        const DWORD error = SetEntriesInAclW(2, entries, nullptr, &acl);
        if (error != ERROR_SUCCESS) Fail("build-acl", error);
        return LocalMemory(acl);
    }

    void SetAndCheck(HANDLE handle, PACL acl, bool directory) {
        DWORD error = SetSecurityInfo(handle, SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION, nullptr, nullptr, acl, nullptr);
        if (error != ERROR_SUCCESS) Fail("set-acl", error);
        PACL actual{};
        PSECURITY_DESCRIPTOR descriptor{};
        error = GetSecurityInfo(handle, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, nullptr, nullptr,
            &actual, nullptr, &descriptor);
        LocalMemory descriptorMemory(descriptor);
        if (error != ERROR_SUCCESS) Fail("read-acl", error);
        SECURITY_DESCRIPTOR_CONTROL control{};
        DWORD revision{};
        if (!GetSecurityDescriptorControl(descriptor, &control, &revision)) Fail("read-acl-control");
        if (!(control & SE_DACL_PROTECTED) || !actual || actual->AceCount != 2)
            Fail("unexpected-acl", ERROR_INVALID_DATA);
        int matchingSids = 0;
        for (DWORD i = 0; i < actual->AceCount; ++i) {
            void* entry{};
            if (!GetAce(actual, i, &entry)) Fail("read-access-entry");
            const auto* ace = static_cast<ACCESS_ALLOWED_ACE*>(entry);
            const BYTE flags = directory ? OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE : 0;
            if (ace->Header.AceType != ACCESS_ALLOWED_ACE_TYPE || ace->Header.AceFlags != flags ||
                ace->Mask != FILE_ALL_ACCESS) Fail("unexpected-access-entry", ERROR_INVALID_DATA);
            auto sid = const_cast<DWORD*>(&ace->SidStart);
            if (EqualSid(sid, User())) matchingSids |= 1;
            else if (EqualSid(sid, systemSid.data())) matchingSids |= 2;
            else Fail("unexpected-principal", ERROR_INVALID_DATA);
        }
        if (matchingSids != 3) Fail("missing-principal", ERROR_INVALID_DATA);
    }

private:
    PSID User() { return reinterpret_cast<TOKEN_USER*>(tokenInfo.data())->User.Sid; }
};

void ProtectDirectory(Path directory, bool protectKeyState) {
    directory.make_preferred();
    const auto rootName = directory.root_name().native();
    if (!directory.is_absolute() || rootName == L"\\\\?" || rootName == L"\\\\.")
        Fail("invalid-directory", ERROR_INVALID_NAME);
    const int firstComponent = rootName.starts_with(L"\\\\") ? 1 : 0;
    std::vector<Path> parts;
    for (const auto& part : directory.relative_path()) {
        const auto name = part.native();
        if (name.empty() || name.back() == L'.' || name.back() == L' ' ||
            name.find_first_of(L":*?\"<>|") != std::wstring::npos)
            Fail("invalid-component", ERROR_INVALID_NAME);
        parts.push_back(part);
    }
    if (parts.size() <= static_cast<size_t>(firstComponent)) Fail("invalid-directory", ERROR_INVALID_NAME);

    Rules rules;
    const auto directoryAcl = rules.MakeAcl(true);
    SECURITY_DESCRIPTOR security{};
    if (!InitializeSecurityDescriptor(&security, SECURITY_DESCRIPTOR_REVISION) ||
        !SetSecurityDescriptorDacl(&security, TRUE, static_cast<PACL>(directoryAcl.get()), FALSE) ||
        !SetSecurityDescriptorControl(&security, SE_DACL_PROTECTED, SE_DACL_PROTECTED))
        Fail("build-directory-security");
    SECURITY_ATTRIBUTES attrs{sizeof(attrs), &security, FALSE};

    Path current = directory.root_path();
    if (firstComponent) current /= parts.front();
    // Keep the checked directories open without FILE_SHARE_DELETE through verification.
    std::vector<Handle> parents;
    parents.push_back(Open(current, DirectoryReadAccess, true));
    for (size_t i = firstComponent; i < parts.size(); ++i) {
        current /= parts[i];
        const bool last = i + 1 == parts.size();
        const DWORD access = DirectoryReadAccess | (last ? ChangeAclAccess : 0);
        auto handle = Open(current, access, true, true);
        if (!handle) {
            if (!CreateDirectoryW(current.c_str(), last ? &attrs : nullptr) && GetLastError() != ERROR_ALREADY_EXISTS)
                Fail("create-directory");
            handle = Open(current, access, true);
        }
        parents.push_back(std::move(handle));
    }
    // Validate and pin an existing key before parent rights can propagate to it.
    const auto key = protectKeyState
        ? Open(directory / L"Local State", KeyReadAccess | ChangeAclAccess, false, true) : Handle{};
    if (key) {
        const auto keyAcl = rules.MakeAcl(false);
        rules.SetAndCheck(key.get(), static_cast<PACL>(keyAcl.get()), false);
    }
    rules.SetAndCheck(parents.back().get(), static_cast<PACL>(directoryAcl.get()), true);
}
}

int wmain(int argc, wchar_t** argv) {
    if (argc != 3) return 2;
    const std::wstring_view mode(argv[1]);
    if (mode != L"directory" && mode != L"key-directory") return 2;
    try {
        ProtectDirectory(Path(argv[2]), mode == L"key-directory");
        return 0;
    } catch (const Failure& failure) {
        std::fprintf(stderr, "%s: %lu\n", failure.operation, failure.error);
        return 1;
    } catch (...) {
        return 1;
    }
}
