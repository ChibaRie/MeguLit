# SPDX-License-Identifier: GPL-3.0-or-later
# 2026-11-13 card wall pictures (services/card-wall.cjs): one run handles a JSON list of jobs.
#  {mode:'thumb', in, out, max}                    a JPEG no longer than max on its long edge
#  {mode:'crop',  in, out, x, y, scale, w, h}      the card face: the largest w:h window, shrunk by scale (>=1),
#                                                  centred on (x,y) in 0..1 of the picture, clamped inside, drawn at w x h
# Writes "<index>\t<ok|error>\t<srcW>\t<srcH>" per job to stdout.
# 2026-11-15 -Serve: a long-lived thumbnailer for the background save-CG worker (user: the PC froze while save CGs
# decoded). It enters Windows background mode (low CPU, I/O and memory priority), sets the parent worker's I/O
# priority to very low, prints READY, then reads one JSON job per line from stdin and answers one line each:
#  a job as above              -> "ok|error <tab> srcW <tab> srcH" prefixed by "R"
#  {mode:'state'}              -> "S <tab> SHQueryUserNotificationState <tab> foreground window's process id"
# The Win32 helper is compiled once into -CacheDir and only loaded afterwards.
param([string]$JobFile, [switch]$Serve, [int]$ParentPid = 0, [string]$CacheDir = '')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters 1
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]86)

function Invoke-CardJob($j) {
  $src = $null; $dst = $null; $g = $null; $ms = $null
  try {
    $bytes = [System.IO.File]::ReadAllBytes($j.in)
    $ms = New-Object System.IO.MemoryStream (,$bytes)
    $src = [System.Drawing.Image]::FromStream($ms)
    $W = $src.Width; $H = $src.Height
    if ($j.mode -eq 'crop') {
      $ow = [int]$j.w; $oh = [int]$j.h; $aspect = $ow / $oh
      if ($W / $H -gt $aspect) { $cw = $H * $aspect; $ch = $H } else { $cw = $W; $ch = $W / $aspect }
      $s = [double]$j.scale; if ($s -lt 1) { $s = 1 }; if ($s -gt 8) { $s = 8 }
      $cw = $cw / $s; $ch = $ch / $s
      $cx = [double]$j.x * $W - $cw / 2; $cy = [double]$j.y * $H - $ch / 2
      $cx = [Math]::Max(0, [Math]::Min($W - $cw, $cx)); $cy = [Math]::Max(0, [Math]::Min($H - $ch, $cy))
      $rect = New-Object System.Drawing.RectangleF ([single]$cx), ([single]$cy), ([single]$cw), ([single]$ch)
    } else {
      $max = [int]$j.max; $k = [Math]::Min([double]1, [double]$max / [Math]::Max($W, $H))
      $ow = [Math]::Max(1, [int]($W * $k)); $oh = [Math]::Max(1, [int]($H * $k))
      $rect = New-Object System.Drawing.RectangleF 0, 0, $W, $H
    }
    $dst = New-Object System.Drawing.Bitmap $ow, $oh
    $g = [System.Drawing.Graphics]::FromImage($dst)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Black)
    # decoded engine pictures (TLG, g00) may carry alpha 0 on opaque art: draw every pixel opaque
    $cm = New-Object System.Drawing.Imaging.ColorMatrix; $cm.Matrix33 = 0; $cm.Matrix43 = 1
    $ia = New-Object System.Drawing.Imaging.ImageAttributes; $ia.SetColorMatrix($cm)
    $g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $ow, $oh), [single]$rect.X, [single]$rect.Y, [single]$rect.Width, [single]$rect.Height, [System.Drawing.GraphicsUnit]::Pixel, $ia)
    $tmp = $j.out + '.tmp'
    $dst.Save($tmp, $codec, $params)
    Move-Item -LiteralPath $tmp -Destination $j.out -Force
    return "ok`t$W`t$H"
  } catch {
    $msg = ($_.Exception.Message -replace '[\r\n\t]', ' ')
    return "error`t0`t0`t$msg"
  } finally {
    if ($g) { $g.Dispose() }; if ($dst) { $dst.Dispose() }; if ($src) { $src.Dispose() }; if ($ms) { $ms.Dispose() }
  }
}

if (-not $Serve) {
  $jobs = Get-Content -LiteralPath $JobFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $i = 0
  foreach ($j in $jobs) { [Console]::Out.WriteLine("$i`t" + (Invoke-CardJob $j)); $i++ }
  return
}

# ---- -Serve ----
$bg = $null
try {
  $src = @'
using System; using System.Runtime.InteropServices;
public static class MeguLitCardBg {
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern bool SetPriorityClass(IntPtr h, uint c);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint a, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("ntdll.dll")] static extern int NtSetInformationProcess(IntPtr h, int cls, ref int v, int len);
  [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int s);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr w, out int pid);
  // PROCESS_MODE_BACKGROUND_BEGIN: low CPU, I/O and memory priority for this process
  public static bool Background() { return SetPriorityClass(GetCurrentProcess(), 0x00100000); }
  // ProcessIoPriority (33) = 0 (very low) for another process; PROCESS_SET_INFORMATION (0x200)
  public static bool LowIo(int pid) { IntPtr h = OpenProcess(0x200, false, pid); if (h == IntPtr.Zero) return false; int v = 0; int r = NtSetInformationProcess(h, 33, ref v, 4); CloseHandle(h); return r == 0; }
  public static int Quns() { int s; return SHQueryUserNotificationState(out s) == 0 ? s : 0; }
  public static int ForegroundPid() { int pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); return pid; }
}
'@
  $dll = if ($CacheDir) { Join-Path $CacheDir 'card-bg-v1.dll' } else { $null }
  if ($dll -and (Test-Path -LiteralPath $dll)) { Add-Type -LiteralPath $dll }
  elseif ($dll) { New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null; $tmpDll = "$dll.$PID.tmp.dll"; Add-Type -TypeDefinition $src -OutputAssembly $tmpDll; try { Move-Item -LiteralPath $tmpDll -Destination $dll -Force } catch {}; Add-Type -LiteralPath $(if (Test-Path -LiteralPath $dll) { $dll } else { $tmpDll }) }
  else { Add-Type -TypeDefinition $src }
  $bg = [MeguLitCardBg]
  [void]$bg::Background()
  # background mode lowers I/O and memory priority; the class keeps the CPU share below normal as well
  try { [System.Diagnostics.Process]::GetCurrentProcess().PriorityClass = 'BelowNormal' } catch {}
  if ($ParentPid -gt 0) { [void]$bg::LowIo($ParentPid) }
} catch {
  # without the helper: below-normal CPU priority at least
  try { [System.Diagnostics.Process]::GetCurrentProcess().PriorityClass = 'BelowNormal' } catch {}
}
[Console]::Out.WriteLine('READY'); [Console]::Out.Flush()
$n = 0
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.Trim()) { continue }
  try { $j = $line | ConvertFrom-Json } catch { [Console]::Out.WriteLine("R`terror`t0`t0"); [Console]::Out.Flush(); continue }
  if ($j.mode -eq 'state') {
    $q = 0; $fg = 0; if ($bg) { try { $q = $bg::Quns(); $fg = $bg::ForegroundPid() } catch {} }
    [Console]::Out.WriteLine("S`t$q`t$fg")
  } else {
    [Console]::Out.WriteLine("R`t" + (Invoke-CardJob $j))
    # the picture buffers are large and short-lived: give them back now rather than letting the heap grow
    if ((++$n % 8) -eq 0) { [System.GC]::Collect() }
  }
  [Console]::Out.Flush()
}
