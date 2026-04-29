using System.Diagnostics;
using System.Drawing;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Sonotext.Launcher;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        using var context = new SonotextApplicationContext();
        Application.Run(context);
    }
}

internal sealed class SonotextApplicationContext : ApplicationContext
{
    private const int BackendPort = 8000;
    private readonly string appRoot;
    private readonly string backendDirectory;
    private readonly string backendUrl;
    private readonly string logPath;
    private readonly Icon appIcon;
    private readonly NotifyIcon trayIcon;
    private readonly MainForm mainForm;
    private Process? backendProcess;
    private bool quitRequested;

    public SonotextApplicationContext()
    {
        appRoot = ResolveAppRoot();
        backendDirectory = Path.Combine(appRoot, "backend");
        backendUrl = $"http://127.0.0.1:{BackendPort}";
        logPath = Path.Combine(backendDirectory, "logs", "sonotext.log");
        appIcon = LoadAppIcon(appRoot);

        Directory.CreateDirectory(Path.GetDirectoryName(logPath)!);

        mainForm = new MainForm(backendUrl, appIcon);
        mainForm.FormClosing += HandleMainFormClosing;

        trayIcon = new NotifyIcon
        {
            Icon = appIcon,
            Text = "Sonotext",
            Visible = true,
            ContextMenuStrip = BuildTrayMenu()
        };
        trayIcon.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) OpenWindow(); };

        if (!EnsurePortAvailable())
        {
            MessageBox.Show($"Sonotext cannot start because port {BackendPort} is already in use.", "Sonotext", MessageBoxButtons.OK, MessageBoxIcon.Error);
            quitRequested = true;
            ExitThread();
            return;
        }

        if (!File.Exists(Path.Combine(appRoot, "frontend", "dist", "index.html")))
        {
            MessageBox.Show("The built frontend was not found. Run install.bat before launching Sonotext.exe.", "Sonotext", MessageBoxButtons.OK, MessageBoxIcon.Error);
            quitRequested = true;
            ExitThread();
            return;
        }

        StartBackend();
        mainForm.Show();
        _ = mainForm.WaitForBackendAsync();
    }

    private ContextMenuStrip BuildTrayMenu()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open", null, (_, _) => OpenWindow());
        menu.Items.Add("View Logs", null, (_, _) => ViewLogs());
        menu.Items.Add("Restart Backend", null, async (_, _) => await RestartBackendAsync());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Quit", null, (_, _) => Quit());
        return menu;
    }

    private static string ResolveAppRoot()
    {
        var baseDirectory = AppContext.BaseDirectory;
        var current = new DirectoryInfo(baseDirectory);

        while (current is not null)
        {
            if (Directory.Exists(Path.Combine(current.FullName, "backend")) && Directory.Exists(Path.Combine(current.FullName, "frontend")))
            {
                return current.FullName;
            }

            current = current.Parent;
        }

        return Path.GetFullPath(Path.Combine(baseDirectory, ".."));
    }

    private static Icon LoadAppIcon(string appRoot)
    {
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "sonotext.ico"),
            Path.Combine(appRoot, "frontend", "public", "favicon", "favicon.ico"),
            Path.Combine(appRoot, "frontend", "dist", "favicon", "favicon.ico"),
        };

        foreach (var candidate in candidates)
        {
            if (File.Exists(candidate))
            {
                return new Icon(candidate);
            }
        }

        return (Icon)SystemIcons.Application.Clone();
    }

    private bool EnsurePortAvailable()
    {
        try
        {
            using var listener = new TcpListener(IPAddress.Loopback, BackendPort);
            listener.Start();
            return true;
        }
        catch (SocketException)
        {
            return false;
        }
    }

    private void StartBackend()
    {
        if (!Directory.Exists(backendDirectory))
        {
            MessageBox.Show($"Backend folder not found:\n{backendDirectory}", "Sonotext", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        var pythonPath = ResolvePythonPath();
        var startInfo = new ProcessStartInfo
        {
            FileName = pythonPath,
            Arguments = "main.py",
            WorkingDirectory = backendDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };

        backendProcess = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        backendProcess.OutputDataReceived += (_, e) => AppendLog(e.Data);
        backendProcess.ErrorDataReceived += (_, e) => AppendLog(e.Data);
        backendProcess.Exited += (_, _) => AppendLog($"Backend exited with code {backendProcess?.ExitCode}");

        try
        {
            backendProcess.Start();
            backendProcess.BeginOutputReadLine();
            backendProcess.BeginErrorReadLine();
        }
        catch (Exception ex)
        {
            AppendLog($"Failed to start backend: {ex}");
            MessageBox.Show($"Failed to start the Sonotext backend.\n\n{ex.Message}\n\nSee logs at:\n{logPath}", "Sonotext", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private string ResolvePythonPath()
    {
        var venvPython = Path.Combine(backendDirectory, ".venv", "Scripts", "python.exe");
        return File.Exists(venvPython) ? venvPython : "python";
    }

    private void AppendLog(string? line)
    {
        if (string.IsNullOrEmpty(line))
        {
            return;
        }

        try
        {
            File.AppendAllText(logPath, $"{DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss.fff zzz} [launcher] {line}{Environment.NewLine}");
        }
        catch
        {
        }
    }

    private void OpenWindow()
    {
        if (mainForm.IsDisposed)
        {
            return;
        }

        mainForm.Show();

        if (mainForm.WindowState == FormWindowState.Minimized)
        {
            mainForm.WindowState = FormWindowState.Normal;
        }

        mainForm.Activate();
    }

    private void ViewLogs()
    {
        OpenWindow();

        if (mainForm.BackendReady)
        {
            mainForm.OpenLogsPanel();
            return;
        }

        try
        {
            Process.Start(new ProcessStartInfo("notepad.exe", logPath) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Unable to open logs.\n\n{ex.Message}", "Sonotext", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private async Task RestartBackendAsync()
    {
        StopBackend();

        if (!EnsurePortAvailable())
        {
            MessageBox.Show($"Cannot restart because port {BackendPort} is still in use.", "Sonotext", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        StartBackend();
        await mainForm.WaitForBackendAsync();
    }

    private void StopBackend()
    {
        if (backendProcess is null)
        {
            return;
        }

        try
        {
            if (!backendProcess.HasExited)
            {
                backendProcess.Kill(entireProcessTree: true);
                backendProcess.WaitForExit(5000);
            }
        }
        catch (Exception ex)
        {
            AppendLog($"Failed to stop backend: {ex}");
        }
        finally
        {
            backendProcess.Dispose();
            backendProcess = null;
        }
    }

    private void HandleMainFormClosing(object? sender, FormClosingEventArgs e)
    {
        if (quitRequested)
        {
            return;
        }

        e.Cancel = true;
        mainForm.Hide();
    }

    private void Quit()
    {
        quitRequested = true;
        trayIcon.Visible = false;
        StopBackend();
        mainForm.Close();
        ExitThread();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            trayIcon.Dispose();
            appIcon.Dispose();
            mainForm.Dispose();
            StopBackend();
        }

        base.Dispose(disposing);
    }
}

internal sealed class MainForm : Form
{
    private readonly string backendUrl;
    private readonly WebView2 webView;
    private readonly Label loadingLabel;
    private readonly Bitmap? loadingLogo;
    private readonly HttpClient httpClient = new() { Timeout = TimeSpan.FromSeconds(2) };

    public bool BackendReady { get; private set; }

    public MainForm(string backendUrl, Icon appIcon)
    {
        this.backendUrl = backendUrl;
        Text = "Sonotext";
        Icon = appIcon;
        Width = 1280;
        Height = 860;
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(960, 640);
        BackColor = Color.FromArgb(10, 10, 16);

        loadingLogo = LoadLoadingLogo();
        webView = new WebView2 { Dock = DockStyle.Fill, Visible = false };
        loadingLabel = new Label
        {
            Dock = DockStyle.Fill,
            Text = "",
            ForeColor = Color.White,
            BackColor = Color.FromArgb(10, 10, 16),
            Image = loadingLogo,
            ImageAlign = ContentAlignment.MiddleCenter,
            TextAlign = ContentAlignment.MiddleCenter,
            Font = new Font(SystemFonts.MessageBoxFont?.FontFamily ?? FontFamily.GenericSansSerif, 18, FontStyle.Regular)
        };

        Controls.Add(webView);
        Controls.Add(loadingLabel);
    }

    private static Bitmap? LoadLoadingLogo()
    {
        var logoPath = Path.Combine(AppContext.BaseDirectory, "sonotext-logo.png");
        if (!File.Exists(logoPath))
        {
            return null;
        }

        using var original = Image.FromFile(logoPath);
        const int maxSize = 256;
        var ratio = Math.Min((double)maxSize / original.Width, (double)maxSize / original.Height);
        if (ratio >= 1.0)
        {
            return new Bitmap(original);
        }

        var newWidth = (int)(original.Width * ratio);
        var newHeight = (int)(original.Height * ratio);
        var scaled = new Bitmap(newWidth, newHeight);
        using (var g = Graphics.FromImage(scaled))
        {
            g.DrawImage(original, 0, 0, newWidth, newHeight);
        }
        return scaled;
    }

    public async Task WaitForBackendAsync()
    {
        BackendReady = false;
        webView.Visible = false;
        loadingLabel.Visible = true;
        loadingLabel.Text = "";

        for (var attempt = 0; attempt < 120; attempt++)
        {
            try
            {
                using var response = await httpClient.GetAsync($"{backendUrl}/health");
                if (response.IsSuccessStatusCode)
                {
                    BackendReady = true;
                    await NavigateToAppAsync();
                    return;
                }
            }
            catch
            {
            }

            await Task.Delay(1000);
        }

        loadingLabel.Text = "Sonotext backend did not become ready. Use the tray menu to view logs or restart the backend.";
    }

    public void OpenLogsPanel()
    {
        if (!BackendReady)
        {
            return;
        }

        if (webView.CoreWebView2 is null)
        {
            webView.Source = new Uri($"{backendUrl}/?logs=1");
            return;
        }

        _ = webView.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new Event('sonotext-open-logs'))");
    }

    private async Task NavigateToAppAsync()
    {
        if (webView.CoreWebView2 is null)
        {
            await webView.EnsureCoreWebView2Async();
        }

        webView.Source = new Uri(backendUrl);
        loadingLabel.Visible = false;
        webView.Visible = true;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            loadingLogo?.Dispose();
            httpClient.Dispose();
        }

        base.Dispose(disposing);
    }
}
