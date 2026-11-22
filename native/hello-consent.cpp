#include <windows.h>
#include <userconsentverifierinterop.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Security.Credentials.UI.h>
#include <string_view>
#include <cwchar>
#include <cerrno>

using namespace winrt;
using namespace winrt::Windows::Foundation;
using namespace winrt::Windows::Security::Credentials::UI;

int wmain(int argc, wchar_t** argv) {
  if (argc != 4) return 2;
  wchar_t* end = nullptr;
  errno = 0;
  const auto parentWindow = std::wcstoull(argv[1], &end, 16);
  if (errno || end == argv[1] || *end || !parentWindow) return 2;
  const HWND owner = reinterpret_cast<HWND>(static_cast<UINT_PTR>(parentWindow));
  errno = 0;
  const auto parentPid = std::wcstoul(argv[2], &end, 10);
  DWORD windowPid = 0;
  if (errno || end == argv[2] || *end || !parentPid ||
      !GetWindowThreadProcessId(owner, &windowPid) || windowPid != parentPid ||
      !IsWindowVisible(owner) || IsIconic(owner)) return 2;
  const auto language = std::wstring_view(argv[3]);
  if (language != L"de" && language != L"en") return 2;
  try {
    init_apartment(apartment_type::multi_threaded);
    if (UserConsentVerifier::CheckAvailabilityAsync().get() != UserConsentVerifierAvailability::Available) return 2;
    const auto interop = get_activation_factory<UserConsentVerifier, ::IUserConsentVerifierInterop>();
    const hstring message(language == L"en" ? L"Show the RSI pledge total in Sarevoc's CCU Planner" :
      L"RSI-Pledge-Summe in Sarevocs CCU Planer anzeigen");
    IAsyncOperation<UserConsentVerificationResult> operation{nullptr};
    check_hresult(interop->RequestVerificationForWindowAsync(owner, static_cast<HSTRING>(get_abi(message)),
      guid_of<decltype(operation)>(), put_abi(operation)));
    const auto outcome = operation.get();
    if (outcome == UserConsentVerificationResult::Verified) return 0;
    return outcome == UserConsentVerificationResult::Canceled ? 1 : 2;
  } catch (...) {
    return 2;
  }
}
