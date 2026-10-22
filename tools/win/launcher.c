/* BrickHack.exe: the Windows launcher.
 *
 * Starts the game server (node\node.exe server\server.js) in the background,
 * opens the game in a window of its own (Edge's app mode: no tabs, no address
 * bar; else Chrome; else the default browser) and, when that window closes,
 * has the server save every game and stop.  A job object makes sure nothing is
 * left running if the launcher itself is killed.
 *
 * Built by tools/package-windows.sh: x86_64-w64-mingw32-gcc -mwindows ...
 */
#include <winsock2.h>
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <stdio.h>
#include <string.h>

#define PORT 18080
#define URL "http://127.0.0.1:18080/"

static void fail(const char *what)
{
    MessageBoxA(NULL, what, "BrickHack", MB_OK | MB_ICONERROR);
    ExitProcess(1);
}

/* send one HTTP request to the server; 1 if it answered */
static int http(const char *request)
{
    SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    struct sockaddr_in a;
    char buf[256];
    int ok = 0;
    if (s == INVALID_SOCKET) return 0;
    memset(&a, 0, sizeof a);
    a.sin_family = AF_INET;
    a.sin_port = htons(PORT);
    a.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (connect(s, (struct sockaddr *) &a, sizeof a) == 0) {
        send(s, request, (int) strlen(request), 0);
        ok = recv(s, buf, sizeof buf, 0) > 0;
    }
    closesocket(s);
    return ok;
}

/* open the game window; returns the window's process (to wait for), or NULL
   if it went to an ordinary browser tab */
static HANDLE open_window(void)
{
    char profile[MAX_PATH], args[MAX_PATH + 512];
    const char *browsers[] = { "msedge", "chrome" };
    int i;
    /* a profile of its own, so closing the game's window ends its process */
    if (SHGetFolderPathA(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, profile) != S_OK)
        GetTempPathA(MAX_PATH, profile);
    strcat(profile, "\\BrickHack\\window");
    snprintf(args, sizeof args,
             "--app=" URL " --user-data-dir=\"%s\" --no-first-run --no-default-browser-check "
             "--window-size=1280,800 --autoplay-policy=no-user-gesture-required",
             profile);
    for (i = 0; i < 2; i++) {
        SHELLEXECUTEINFOA ei;
        memset(&ei, 0, sizeof ei);
        ei.cbSize = sizeof ei;
        ei.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_FLAG_NO_UI;
        ei.lpFile = browsers[i];
        ei.lpParameters = args;
        ei.nShow = SW_SHOWNORMAL;
        if (ShellExecuteExA(&ei) && ei.hProcess)
            return ei.hProcess;
    }
    ShellExecuteA(NULL, "open", URL, NULL, NULL, SW_SHOWNORMAL);
    return NULL;
}

int WINAPI WinMain(HINSTANCE inst, HINSTANCE prev, LPSTR cmdline, int show)
{
    char dir[MAX_PATH], cmd[MAX_PATH * 2];
    char *slash;
    STARTUPINFOA si;
    PROCESS_INFORMATION server;
    HANDLE job, window;
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION lim;
    WSADATA wsa;
    int i;
    (void) inst; (void) prev; (void) cmdline; (void) show;

    /* everything lives next to BrickHack.exe */
    GetModuleFileNameA(NULL, dir, MAX_PATH);
    if ((slash = strrchr(dir, '\\')) != NULL) *slash = '\0';
    SetCurrentDirectoryA(dir);
    WSAStartup(MAKEWORD(2, 2), &wsa);

    if (http("GET /api/saves HTTP/1.0\r\n\r\n")) { /* already running: just another window */
        if ((window = open_window()) != NULL) WaitForSingleObject(window, INFINITE);
        return 0;
    }

    /* the server, with no console window; it and its games die with this job */
    job = CreateJobObjectA(NULL, NULL);
    memset(&lim, 0, sizeof lim);
    lim.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    SetInformationJobObject(job, JobObjectExtendedLimitInformation, &lim, sizeof lim);
    SetEnvironmentVariableA("PORT", "18080");
    SetEnvironmentVariableA("HOST", "127.0.0.1");
    snprintf(cmd, sizeof cmd, "\"%s\\node\\node.exe\" \"%s\\server\\server.js\"", dir, dir);
    memset(&si, 0, sizeof si);
    si.cb = sizeof si;
    if (!CreateProcessA(NULL, cmd, NULL, NULL, FALSE, CREATE_NO_WINDOW | CREATE_SUSPENDED, NULL, dir, &si, &server))
        fail("Couldn't start the game server (node\\node.exe is missing?).");
    AssignProcessToJobObject(job, server.hProcess);
    ResumeThread(server.hThread);

    for (i = 0; i < 150 && !http("GET /api/saves HTTP/1.0\r\n\r\n"); i++) Sleep(100);
    if (i == 150) fail("The game server didn't start.");

    if ((window = open_window()) != NULL)
        WaitForSingleObject(window, INFINITE);
    else
        MessageBoxA(NULL, "BrickHack is running in your web browser.\n\nClick OK when you're done playing.",
                    "BrickHack", MB_OK | MB_ICONINFORMATION);

    /* save every game, give it a moment, then the job takes the rest down */
    http("POST /api/quit HTTP/1.0\r\nContent-Length: 0\r\n\r\n");
    WaitForSingleObject(server.hProcess, 20000);
    CloseHandle(job);
    return 0;
}
