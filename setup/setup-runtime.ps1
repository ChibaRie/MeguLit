# SPDX-License-Identifier: GPL-3.0-or-later
# MeguLit first-launch setup.
# The release zip ships without runtime\. This window lets the user pick:
#   Lite  = base pack only (Node, Python, hooks, JMdict). Other packs can be added later in Settings.
#   Full  = base + furigana dictionaries + voice engine, all at once.
# Everything is installed into the chosen MeguLit folder (runtime\ next to MeguLit.exe), so a fresh
# PC needs nothing preinstalled except the WebView2 Runtime (built into Windows 11).
# Since 1.4.6 the window also asks where MeguLit lives and whether to put shortcuts on the desktop / Start menu.
# Group report (2026-11-12): a player opened MeguLit.exe straight from the archive viewer, so it ran from
# %TEMP%\Rar$EXa..., installed onto a nearly full C: drive and left no shortcut. When the chosen folder is not
# this one, the whole MeguLit folder is copied there first, then the new copy is started (exit 3 = moved).
# Packs, URLs, SHA-256 and sizes come from setup\runtime.json. Exit 0 = runtime ready.
param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
[Windows.Forms.Application]::EnableVisualStyles()

$manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'setup\runtime.json') | ConvertFrom-Json
$packs = $manifest.packs
$appSize = 40MB
function MB($n) { if ($n -ge 1GB) { '{0:N1} GB' -f ($n/1GB) } else { '{0:N0} MB' -f ($n/1MB) } }
$lite = @('base'); $full = @('base','reading','voice')
function Sum($ids, $field) { $t = 0; foreach ($i in $ids) { $t += $packs.$i.$field }; $t }

# WebView2 Runtime is the one thing MeguLit cannot ship itself (Windows 11 has it; some Windows 10 PCs do not).
function Has-WebView2 {
  $id = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
  foreach ($k in "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$id", "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$id", "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$id") {
    try { $v = (Get-ItemProperty -Path $k -Name pv -ErrorAction Stop).pv; if ($v -and $v -ne '0.0.0.0') { return $true } } catch {}
  }
  return $false
}
$webview = Has-WebView2

# Palette: dark grimoire, cream pages, crimson ribbon, a little gold.
$C = @{
  bg    = [Drawing.Color]::FromArgb(24,19,20);  card  = [Drawing.Color]::FromArgb(38,30,31)
  line  = [Drawing.Color]::FromArgb(62,48,49);  cream = [Drawing.Color]::FromArgb(243,233,220)
  muted = [Drawing.Color]::FromArgb(170,154,144); red  = [Drawing.Color]::FromArgb(200,50,60)
  gold  = [Drawing.Color]::FromArgb(217,165,74)
}
$ui = 'Microsoft YaHei UI'
# Flat buttons default to a white hover; give them grimoire colours instead.
function Style-Button($b, [bool]$primary) {
  $b.FlatStyle = 'Flat'; $b.UseVisualStyleBackColor = $false; $b.ForeColor = $C.cream; $b.Cursor = 'Hand'
  if ($primary) { $b.BackColor = $C.red; $b.FlatAppearance.BorderColor = $C.red; $b.FlatAppearance.MouseOverBackColor = [Drawing.Color]::FromArgb(222,72,82); $b.FlatAppearance.MouseDownBackColor = [Drawing.Color]::FromArgb(168,38,48) }
  else { $b.BackColor = $C.card; $b.FlatAppearance.MouseOverBackColor = [Drawing.Color]::FromArgb(64,40,43); $b.FlatAppearance.MouseDownBackColor = [Drawing.Color]::FromArgb(84,48,52) }
}
function Img($name) { $p = Join-Path $Root "setup\$name"; if (Test-Path $p) { [Drawing.Image]::FromFile($p) } }
$logo = Img 'logo.png'

# Double-buffered panel so the hand-drawn line art does not flicker.
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @'
public class GrimoirePanel : System.Windows.Forms.Panel {
  public GrimoirePanel() { this.DoubleBuffered = true; this.SetStyle(System.Windows.Forms.ControlStyles.ResizeRedraw, true); }
}
'@

function Pen($color, $alpha, $w) { New-Object Drawing.Pen ([Drawing.Color]::FromArgb($alpha, $color)), $w }
function Draw-Circle($g, $cx, $cy, $r, $color, $alpha) {
  $p = Pen $color $alpha 1
  foreach ($k in 1.0, 0.9, 0.58, 0.22) { $rr = $r * $k; $g.DrawEllipse($p, [float]($cx-$rr), [float]($cy-$rr), [float](2*$rr), [float](2*$rr)) }
  foreach ($rot in 0, 180) {
    $pts = foreach ($i in 0..2) { $a = ($rot - 90 + $i*120) * [math]::PI / 180; New-Object Drawing.PointF ([float]($cx + $r*0.9*[math]::Cos($a))), ([float]($cy + $r*0.9*[math]::Sin($a))) }
    $g.DrawPolygon($p, [Drawing.PointF[]]$pts)
  }
  $p.Dispose()
}
function Draw-Book($g, $x, $y, $color) {
  $p = Pen $color 255 1.6
  $g.DrawBezier($p, $x, $y+4, $x+6, $y, $x+11, $y+1, $x+14, $y+4); $g.DrawBezier($p, $x+14, $y+4, $x+17, $y+1, $x+22, $y, $x+28, $y+4)
  $g.DrawLine($p, $x, $y+4, $x, $y+20); $g.DrawLine($p, $x+28, $y+4, $x+28, $y+20); $g.DrawLine($p, $x+14, $y+4, $x+14, $y+22)
  $g.DrawBezier($p, $x, $y+20, $x+6, $y+16, $x+11, $y+17, $x+14, $y+22); $g.DrawBezier($p, $x+14, $y+22, $x+17, $y+17, $x+22, $y+16, $x+28, $y+20)
  $p.Dispose()
}

# The setup runs inside powershell.exe, so the taskbar grouped it with PowerShell and showed PowerShell's icon.
# An own AppUserModelID gives the window its own taskbar entry with the MeguLit icon set below.
try { Add-Type -Namespace MeguLit -Name Shell -MemberDefinition '[DllImport("shell32.dll")] public static extern int SetCurrentProcessExplicitAppUserModelID([MarshalAs(UnmanagedType.LPWStr)] string id);'; [void][MeguLit.Shell]::SetCurrentProcessExplicitAppUserModelID('app.megulit.setup') } catch {}
$form = New-Object Windows.Forms.Form
$form.Text = 'MeguLit'; $form.ClientSize = New-Object Drawing.Size(720,700); $form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'; $form.MaximizeBox = $false; $form.BackColor = $C.bg; $form.ForeColor = $C.cream
$exe = Join-Path $Root 'MeguLit.exe'; if (Test-Path $exe) { $form.Icon = [Drawing.Icon]::ExtractAssociatedIcon($exe) }

function Label($text, $x, $y, $w, $h, $size, $bold, $color, $parent) {
  $l = New-Object Windows.Forms.Label; $l.Text = $text; $l.Location = New-Object Drawing.Point($x,$y); $l.Size = New-Object Drawing.Size($w,$h)
  $style = if ($bold) { [Drawing.FontStyle]::Bold } else { [Drawing.FontStyle]::Regular }
  $l.Font = New-Object Drawing.Font($ui, $size, $style); $l.ForeColor = $color; $l.BackColor = [Drawing.Color]::Transparent
  $parent.Controls.Add($l); $l
}

# ---- shared backdrop: magic circles + header art ----
$stage = New-Object GrimoirePanel; $stage.Dock = 'Fill'; $stage.BackColor = $C.bg
$stage.add_Paint({ param($s,$e)
  $g = $e.Graphics; $g.SmoothingMode = 'AntiAlias'
  Draw-Circle $g 640 70 190 $C.red 46
  Draw-Circle $g 40 560 150 $C.gold 30
  if ($logo) { $g.InterpolationMode = 'HighQualityBicubic'; $g.DrawImage($logo, 30, 18, 212, 81) }
  $p = Pen $C.line 255 1; $g.DrawLine($p, 32, 122, 688, 122); $p.Dispose()
})
$form.Controls.Add($stage)

# ---- choice page ----
$choice = New-Object Windows.Forms.Panel; $choice.Location = New-Object Drawing.Point(0,124); $choice.Size = New-Object Drawing.Size(720,576); $choice.BackColor = [Drawing.Color]::Transparent
$stage.Controls.Add($choice)
[void](Label '第一次使用 MeguLit' 32 12 560 30 14 $true $C.cream $choice)
[void](Label '先下载运行组件。它们都会装进 MeguLit 自己的文件夹，电脑上不用预先安装 Node.js、Python 或其他软件' 32 44 656 20 9 $false $C.muted $choice)
[void](Label '组件包放在 MeguLit 的 GitHub Releases，里面是 Node.js、Python、LunaHook、AivisSpeech 等项目官方发布的原版文件，下载后逐个校验 SHA-256，被改动过的文件不会安装' 32 66 656 34 8 $false $C.muted $choice)
# ---- install location ----
$sourceRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\')
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$fromArchive = ($sourceRoot + '\').StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or $sourceRoot -match '\\(Rar\$|7z[A-Z0-9]|wz[A-Z0-9])'
function Default-Target {
  if (-not $fromArchive) { return $sourceRoot }
  # Opened from inside an archive: suggest the roomiest non-system fixed drive, else the per-user Programs folder.
  $sys = $env:SystemDrive.TrimEnd('\').ToUpper()
  $best = [IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq 'Fixed' -and $_.IsReady -and $_.Name.TrimEnd('\').ToUpper() -ne $sys -and $_.AvailableFreeSpace -gt 3GB } | Sort-Object AvailableFreeSpace -Descending | Select-Object -First 1
  if ($best) { return (Join-Path $best.RootDirectory.FullName 'MeguLit') }
  return (Join-Path $env:LOCALAPPDATA 'Programs\MeguLit')
}
function Drive-Free($path) {
  try { $q = [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($path)); (New-Object IO.DriveInfo $q).AvailableFreeSpace } catch { 0 }
}
$free = Drive-Free (Default-Target)

function Option($x, $title, $sub, $items, $pros, $cons, $ids, $primary, $badge) {
  $p = New-Object GrimoirePanel; $p.Location = New-Object Drawing.Point($x,106); $p.Size = New-Object Drawing.Size(316,346); $p.BackColor = $C.card
  $down = Sum $ids 'size'; $disk = (Sum $ids 'unpacked') + $appSize
  $accent = if ($primary) { $C.red } else { $C.line }
  $edgeColor = if ($primary) { $C.red } else { $C.line }
  $p.add_Paint({ param($s,$e)
    $g = $e.Graphics; $g.SmoothingMode = 'AntiAlias'
    $b = New-Object Drawing.SolidBrush $accent; $g.FillRectangle($b, 0, 0, 316, $(if ($primary) { 4 } else { 2 }))
    if ($primary) { $g.FillPolygon($b, [Drawing.Point[]]@((New-Object Drawing.Point(272,0)),(New-Object Drawing.Point(290,0)),(New-Object Drawing.Point(290,30)),(New-Object Drawing.Point(281,23)),(New-Object Drawing.Point(272,30)))) }; $b.Dispose()
    Draw-Book $g 20 20 $(if ($primary) { $C.red } else { $C.muted })
    $pen = Pen $edgeColor 255 $(if ($primary) { 2 } else { 1 }); $g.DrawRectangle($pen, 0, 0, 315, 345); $pen.Dispose()
    $pen = Pen $C.line 255 1; $g.DrawLine($pen, 20, 262, 296, 262); $pen.Dispose()
  }.GetNewClosure())
  [void](Label $title 58 16 120 30 13 $true $C.cream $p)
  if ($badge) { $bd = Label $badge 132 23 40 18 8 $true $C.cream $p; $bd.BackColor = $C.red; $bd.TextAlign = 'MiddleCenter'; $bd.AutoSize = $false }
  [void](Label $sub 59 44 220 18 8 $false $C.muted $p)
  [void](Label '包含 / Includes' 20 68 280 18 8 $true $(if ($primary) { $C.red } else { $C.muted }) $p)
  [void](Label (($items | ForEach-Object { '·  ' + $_ }) -join "`n") 20 86 286 68 9 $false $C.cream $p)
  [void](Label (($pros | ForEach-Object { '✓  ' + $_ }) -join "`n") 20 158 286 52 9 $false $C.gold $p)
  [void](Label (($cons | ForEach-Object { '–  ' + $_ }) -join "`n") 20 212 286 48 8 $false $C.muted $p)
  [void](Label ('下载约 ' + (MB $down)) 20 270 140 22 10 $true $C.cream $p)
  $warn = if ($free -lt $disk * 1.1) { $C.red } else { $C.muted }
  [void](Label ('占用磁盘约 ' + (MB $disk)) 160 272 140 20 9 $false $warn $p)
  $b = New-Object Windows.Forms.Button; $b.Text = $(if ($primary) { '安装' + $title + '（推荐）' } else { '只装' + $title }); $b.FlatStyle = 'Flat'
  $b.Location = New-Object Drawing.Point(20,$(if ($primary) { 298 } else { 302 })); $b.Size = New-Object Drawing.Size(276,$(if ($primary) { 38 } else { 30 }))
  $b.Font = New-Object Drawing.Font($ui, $(if ($primary) { 11 } else { 9 }), $(if ($primary) { [Drawing.FontStyle]::Bold } else { [Drawing.FontStyle]::Regular })); $b.ForeColor = $C.cream; $b.Cursor = 'Hand'
  Style-Button $b $primary; if (-not $primary) { $b.FlatAppearance.BorderColor = $C.line; $b.ForeColor = $C.muted }
  $b.Tag = $ids; $b.add_Click({ param($s) Start-Install $s.Tag })
  $p.Controls.Add($b); $choice.Controls.Add($p)
  if ($primary) { $form.AcceptButton = $b }
}
$baseItems = @('Node.js 运行时（程序后台服务）','Python 3（分词与注音）','文本 Hook 引擎（读取游戏文字）','JMdict 日英 / 日中离线词典')
Option 32 '完整版' 'FULL · 一次装齐，开箱即用' @('精简版的全部组件','SudachiDict / UniDic 注音分词词典','AivisSpeech 语音引擎（朗读、原声补全）') @('注音和分词更准，生僻词、人名读音更可靠','朗读、制卡配音、原声补全马上能用','装完就不用再下载，断网也能用') @('下载约大五倍，第一次要多等一会','本地翻译模型不含在内，要用时在设置里下载') $full $true '推荐'
Option 372 '精简版' 'LITE · 先用起来' $baseItems @('下载最小，几分钟就能开始玩','读取台词、点读查词、在线翻译都能用') @('第一次显示注音时才补装词典，要等一下','没有语音：朗读、配音要以后在「设置 → 语音 / 词典」补装') $lite $false ''

$runtimeDir = Join-Path $Root 'runtime'
[void](Label '安装位置' 32 465 70 20 9 $true $C.cream $choice)
$pathBox = New-Object Windows.Forms.TextBox; $pathBox.Location = New-Object Drawing.Point(104,462); $pathBox.Size = New-Object Drawing.Size(452,24)
$pathBox.Font = New-Object Drawing.Font($ui, 9); $pathBox.BackColor = $C.card; $pathBox.ForeColor = $C.cream; $pathBox.BorderStyle = 'FixedSingle'
$pathBox.Text = Default-Target; $choice.Controls.Add($pathBox)
$browse = New-Object Windows.Forms.Button; $browse.Text = '更改… Browse'; $browse.Location = New-Object Drawing.Point(566,461); $browse.Size = New-Object Drawing.Size(122,26)
$browse.Font = New-Object Drawing.Font($ui, 9); Style-Button $browse $false; $browse.FlatAppearance.BorderColor = $C.line; $choice.Controls.Add($browse)
function Check($text, $x, $w) {
  $cb = New-Object Windows.Forms.CheckBox; $cb.Text = $text; $cb.Checked = $true; $cb.Location = New-Object Drawing.Point($x,494); $cb.Size = New-Object Drawing.Size($w,22)
  $cb.Font = New-Object Drawing.Font($ui, 9); $cb.ForeColor = $C.cream; $cb.BackColor = [Drawing.Color]::Transparent; $cb.FlatStyle = 'Flat'; $cb.Cursor = 'Hand'
  $choice.Controls.Add($cb); $cb
}
$deskCheck = Check '在桌面创建快捷方式' 32 190
$menuCheck = Check '添加到开始菜单' 226 170
$freeLabel = Label '' 400 496 288 20 8 $false $C.muted $choice; $freeLabel.TextAlign = 'MiddleRight'
function Update-Free { $f = Drive-Free $pathBox.Text; $freeLabel.Text = '所在磁盘可用 ' + (MB $f); $freeLabel.ForeColor = $(if ($f -lt ((Sum $full 'unpacked') + $appSize) * 1.1) { $C.red } else { $C.muted }) }
$pathBox.add_TextChanged({ Update-Free }); Update-Free
$browse.add_Click({
  $d = New-Object Windows.Forms.FolderBrowserDialog; $d.Description = '选择 MeguLit 的安装位置（会在里面建 MeguLit 文件夹）'; $d.ShowNewFolderButton = $true
  if ($d.ShowDialog($form) -eq 'OK') {
    $picked = $d.SelectedPath
    if ((Split-Path $picked -Leaf) -ne 'MeguLit' -and -not (Test-Path (Join-Path $picked 'MeguLit.exe'))) { $picked = Join-Path $picked 'MeguLit' }
    $pathBox.Text = $picked
  }
})
$noteText = if ($fromArchive) { '你是在压缩包里直接打开的：选好安装位置后，MeguLit 会整个复制过去再安装，以后从快捷方式打开就行' } else { '运行组件装进安装位置下的 runtime 文件夹，不会写到别处 · 以后移动 MeguLit 文件夹，组件会跟着一起走' }
$note = Label $noteText 32 524 656 20 8 $fromArchive $(if ($fromArchive) { $C.gold } else { $C.muted }) $choice; $note.AutoEllipsis = $true
if (-not $webview) {
  $link = New-Object Windows.Forms.LinkLabel; $link.Text = '这台电脑缺少 Microsoft Edge WebView2 运行时，MeguLit 的界面需要它：点这里去微软官网下载安装'
  $link.Location = New-Object Drawing.Point(32,548); $link.Size = New-Object Drawing.Size(656,20); $link.Font = New-Object Drawing.Font($ui, 8, [Drawing.FontStyle]::Bold)
  $link.LinkColor = $C.red; $link.ActiveLinkColor = $C.gold; $link.BackColor = [Drawing.Color]::Transparent
  $link.add_LinkClicked({ Start-Process 'https://developer.microsoft.com/microsoft-edge/webview2/' })
  $choice.Controls.Add($link)
}

# ---- progress page ----
$progress = New-Object Windows.Forms.Panel; $progress.Location = New-Object Drawing.Point(0,124); $progress.Size = New-Object Drawing.Size(720,576); $progress.BackColor = [Drawing.Color]::Transparent; $progress.Visible = $false
$stage.Controls.Add($progress)
$title = Label '正在下载运行组件…' 32 40 640 32 14 $true $C.cream $progress
$status = Label '' 32 84 656 44 9 $false $C.muted $progress
# Hand-drawn progress bar: rounded dark track, crimson-to-gold fill, a soft shimmer while unpacking.
$script:barValue = 0; $script:barBusy = $false; $script:barPhase = 0.0
$bar = New-Object GrimoirePanel; $bar.Location = New-Object Drawing.Point(32,132); $bar.Size = New-Object Drawing.Size(656,14); $bar.BackColor = [Drawing.Color]::Transparent
function Round-Rect($x, $y, $w, $h) {
  $r = [math]::Min($h, $w); $gp = New-Object Drawing.Drawing2D.GraphicsPath
  if ($w -le 0) { return $gp }
  $gp.AddArc([float]$x, [float]$y, [float]$r, [float]$h, 90, 180); $gp.AddArc([float]($x + $w - $r), [float]$y, [float]$r, [float]$h, 270, 180); $gp.CloseFigure(); $gp
}
$bar.add_Paint({ param($s,$e)
  $g = $e.Graphics; $g.SmoothingMode = 'AntiAlias'; $w = $bar.Width - 1; $h = $bar.Height - 1
  $track = Round-Rect 0 0 $w $h
  $tb = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(52,41,42)); $g.FillPath($tb, $track); $tb.Dispose()
  if ($script:barBusy) {
    $seg = [int]($w * 0.28); $x = [int](($w + $seg) * $script:barPhase) - $seg
    $g.SetClip($track)
    $rect = New-Object Drawing.Rectangle ($x, 0, [math]::Max(1,$seg), ($h + 1))
    $lg = New-Object Drawing.Drawing2D.LinearGradientBrush $rect, ([Drawing.Color]::FromArgb(0,$C.red)), ([Drawing.Color]::FromArgb(0,$C.gold)), 0.0
    $blend = New-Object Drawing.Drawing2D.ColorBlend 3
    $blend.Colors = @([Drawing.Color]::FromArgb(0,$C.red), $C.red, [Drawing.Color]::FromArgb(0,$C.gold)); $blend.Positions = @(0.0, 0.55, 1.0); $lg.InterpolationColors = $blend
    $g.FillRectangle($lg, $rect); $lg.Dispose(); $g.ResetClip()
  } elseif ($script:barValue -gt 0) {
    $fw = [math]::Max($h, [int]($w * $script:barValue / 1000))
    $fill = Round-Rect 0 0 $fw $h
    $lg = New-Object Drawing.Drawing2D.LinearGradientBrush (New-Object Drawing.Rectangle 0, 0, ($fw + 1), ($h + 1)), $C.red, $C.gold, 0.0
    $g.FillPath($lg, $fill); $lg.Dispose()
    $hl = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(60,255,255,255)); $g.FillRectangle($hl, [float]($h/2), 2, [float]([math]::Max(0,$fw - $h)), [float]([math]::Max(1,$h/4))); $hl.Dispose()
  }
  $edge = Pen $C.line 255 1; $g.DrawPath($edge, $track); $edge.Dispose()
})
$progress.Controls.Add($bar)
$percent = Label '' 600 104 88 20 9 $true $C.gold $progress; $percent.TextAlign = 'MiddleRight'
$shimmer = New-Object Windows.Forms.Timer; $shimmer.Interval = 30
$shimmer.add_Tick({ $script:barPhase = ($script:barPhase + 0.012) % 1.0; $bar.Invalidate() })
function Set-Bar([int]$value) { $script:barBusy = $false; $shimmer.Stop(); $script:barValue = [math]::Max(0, [math]::Min(1000, $value)); $percent.Text = if ($value -gt 0) { ('{0:N0}%' -f ($script:barValue / 10)) } else { '' }; $bar.Invalidate() }
function Set-Busy { $script:barBusy = $true; $percent.Text = ''; $shimmer.Start(); $bar.Invalidate() }
$whereLabel = Label ('安装位置：' + $runtimeDir) 32 160 656 20 8 $false $C.muted $progress; $whereLabel.AutoEllipsis = $true
$button = New-Object Windows.Forms.Button; $button.Text = '取消 Cancel'; $button.FlatStyle = 'Flat'; $button.ForeColor = $C.cream
$button.Font = New-Object Drawing.Font($ui, 9, [Drawing.FontStyle]::Bold); Style-Button $button $false; $button.FlatAppearance.BorderColor = $C.red; $button.Location = New-Object Drawing.Point(568,200); $button.Size = New-Object Drawing.Size(120,34); $button.Cursor = 'Hand'
$progress.Controls.Add($button)

$script:fetch = $null; $script:queue = @(); $script:index = 0; $script:done = $false; $script:mode = ''
$names = @{ base = '基础组件'; reading = '注音分词词典'; voice = '语音引擎' }
# base needs Python's core library too: an interrupted install once left node.exe but no Lib\zipfile.
$markers = @{ base = @('runtime\node.exe','runtime\python\python.exe','runtime\python\Lib\zipfile\__init__.py','runtime\python\Lib\encodings\__init__.py'); reading = 'runtime\reading\sudachidict_full\resources\system.dic'; voice = 'runtime\aivis\run.exe' }

# ---- download source ----
# Users in mainland China often get very slow GitHub downloads. We do not look up the user's IP
# (that would send it to a third-party geo service); the system time zone / UI language is enough
# to decide the source order. Mirrors only relay the same GitHub file; SHA-256 still has to match.
$inChina = ([TimeZoneInfo]::Local.Id -eq 'China Standard Time') -or ((Get-Culture).Name -eq 'zh-CN')
# 2026-11-19: players in China sat on dl.megulit.com (Cloudflare R2, throttled there after the first MB) at 9 / 178 MB.
# In China cn-dl (Tencent EdgeOne) now comes first, then the other megulit.com mirror, the GitHub proxies, GitHub last.
# Elsewhere GitHub stays first. The order is only the tie-break: every source is probed in parallel and ranked by speed.
# setup\runtime.json keeps its own mirror order (the app's downloader reads it too); the order is decided here.
function Rank-Sources($urls, [bool]$china) {
  $all = @($urls)
  $rows = for ($i = 0; $i -lt $all.Count; $i++) {
    $h = ([Uri]$all[$i]).Host
    $r = if (-not $china) { if ($h -eq 'github.com') { 0 } else { 1 } } elseif ($h -like 'cn-*') { 0 } elseif ($h -like '*.megulit.com') { 1 } elseif ($h -eq 'github.com') { 3 } else { 2 }
    [pscustomobject]@{ u = $all[$i]; r = $r; i = $i }
  }
  @($rows | Sort-Object r, i | ForEach-Object { $_.u })
}
function Candidates($id) {
  $direct = @($packs.$id.urls)
  $mirrored = foreach ($m in @($manifest.mirrors)) { foreach ($u in $direct) { $seg = $u.Split('/'); $m.Replace('{url}', $u).Replace('{tag}', $seg[-2]).Replace('{file}', $seg[-1]) } }
  Rank-Sources (@($direct) + @($mirrored)) $inChina
}
# Multi-source segmented downloader (compiled on first use, runs on background threads; the window only polls it).
# The old single WebClient stayed on whichever source answered first, even at 20 KB/s, and threw the .part away on retry.
# Now: all sources are probed at once for ~3 s, the file is fetched as 4 MB Range segments over 8 connections from the
# fastest sources, a connection far below the average or silent for 15 s is dropped and its segment goes elsewhere, and
# finished segments are listed in runtime-<id>.setup.part.json so Retry or the next launch only fetches what is missing.
# A source answering 200 instead of 206 (no Range) is only used alone, for the whole file.
# validation\setup-download.test.cjs runs this class against local throttled servers.
$fetchSource = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Security.Cryptography;

public class MeguSource {
  public string Url, Live, Host, Why;
  public int Order, Active, Strikes;
  public double ProbeSpeed, Speed;
  public long ProbeBytes, Bytes, Length = -1, WinBytes, Recent;
  public int Range = -1;   /* -1 unknown, 0 no (200 only), 1 yes (206) */
  public bool Dead;
}

public class MeguConn {
  public MeguSource Src; public int Seg; public long Len, Got, WinGot;
  public HttpWebRequest Req; public DateTime Started, LastData; public double RecentSpeed;
  public volatile bool Killed; public string KillWhy;
}

/* Downloads one file from several mirrors at once: parallel speed probe, HTTP Range segments on
   several connections (fast sources take more segments), slow or stalled connections are dropped and
   their segment goes to another source, finished segments are remembered in <part>.json so a retry or
   a restart only fetches what is missing. The whole file is checked against SHA-256 at the end. */
public class MeguFetch {
  public string[] Urls; public string Part; public long Size; public string Sha;
  public int Connections = 8, MaxPerSource = 6, SegmentSize = 4 << 20, ProbeMs = 3000, ProbeCapMs = 4000, StallMs = 15000, SlowGraceMs = 6000;
  public long ProbeMaxBytes = 16L << 20;
  public double SlowRatio = 0.3;
  public string UserAgent = "MeguLit-setup";

  public volatile string Phase = "idle";
  public string Error = "";
  public long Resumed, ProbeElapsedMs, Steals, SlowKills, StallKills;
  public bool Single;
  public double TotalSpeed;
  public List<MeguSource> Sources = new List<MeguSource>();

  readonly object gate = new object();
  readonly List<MeguConn> conns = new List<MeguConn>();
  readonly LinkedList<int> pending = new LinkedList<int>();
  readonly StringBuilder log = new StringBuilder();
  readonly DateTime t0 = DateTime.UtcNow;
  bool[] done; int segCount; long doneBytes; volatile bool cancel; string failWhy;
  Thread main;

  public string StatePath { get { return Part + ".json"; } }
  public string LogText() { lock (log) return log.ToString(); }
  void Log(string s) { lock (log) log.AppendFormat("{0,6:0.0}s {1}\r\n", (DateTime.UtcNow - t0).TotalSeconds, s); }

  public long Received {
    get { lock (gate) { long n = doneBytes; foreach (MeguConn c in conns) n += Interlocked.Read(ref c.Got); return Math.Min(n, Size); } }
  }
  public string SourceLabel() {
    lock (gate) {
      MeguSource top = null; int busy = 0;
      foreach (MeguSource s in Sources) {
        if (s.Active == 0 && s.Recent == 0) continue;
        if (s.Active > 0) busy++;
        if (top == null || s.Recent > top.Recent || (s.Recent == top.Recent && s.Bytes > top.Bytes)) top = s;
      }
      if (top == null) return "";
      return busy > 1 ? top.Host + " 等 " + busy + " 个源" : top.Host;
    }
  }

  public void Start() {
    main = new Thread(Run); main.IsBackground = true; main.Start();
  }
  public void Cancel() {
    cancel = true;
    lock (gate) { foreach (MeguConn c in conns) Kill(c, "cancel"); Monitor.PulseAll(gate); }
  }
  public bool Wait(int ms) { return main == null || main.Join(ms); }

  void Run() {
    FileStream held = null;
    try {
      /* Two setup windows on one folder must not write the same file: the second one takes its own. */
      for (int k = 0; held == null; k++) {
        string p = k == 0 ? Part : Part + "-" + k;
        try { held = new FileStream(p + ".lock", FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None, 1, FileOptions.DeleteOnClose); Part = p; }
        catch (IOException) { if (k >= 20) throw; }
      }
      if (ServicePointManager.DefaultConnectionLimit < 64) ServicePointManager.DefaultConnectionLimit = 64;
      segCount = (int)((Size + SegmentSize - 1) / SegmentSize);
      for (int i = 0; i < Urls.Length; i++) {
        MeguSource s = new MeguSource(); s.Url = Urls[i]; s.Live = Urls[i]; s.Host = new Uri(Urls[i]).Authority; s.Order = i; Sources.Add(s);
      }
      for (int round = 0; round < 2; round++) {
        LoadState();
        bool complete = Resumed == Size;
        if (!complete) {
          if (round == 0) Probe();
          if (cancel) { Phase = "cancelled"; return; }
          Phase = "download";
          if (HasRangeSource()) Segmented();
          if (!cancel && failWhy == null && doneBytes < Size) WholeFile();
          if (cancel) { Phase = "cancelled"; return; }
          if (failWhy != null || doneBytes < Size) { Fail(failWhy ?? "所有下载源都失败了"); return; }
        }
        Phase = "verify";
        string hash = Hash();
        if (hash == Sha.ToUpperInvariant()) { TryDelete(StatePath); Log("sha256 ok"); Phase = "done"; return; }
        Log("sha256 mismatch " + hash + (round == 0 ? ", downloading again from scratch" : ""));
        TryDelete(StatePath); TryDelete(Part);
        if (round == 1) { Fail("文件校验失败，可能下载不完整"); return; }
      }
    } catch (Exception e) { if (cancel) Phase = "cancelled"; else Fail(e.Message); }
    finally { if (held != null) held.Dispose(); }
  }
  void Fail(string why) { Error = why; Log("failed: " + why); Phase = "failed"; }

  /* ---------- resume state ---------- */
  void LoadState() {
    done = new bool[segCount]; doneBytes = 0; Resumed = 0; Single = false; failWhy = null;
    try {
      if (File.Exists(StatePath) && File.Exists(Part) && new FileInfo(Part).Length == Size) {
        string j = File.ReadAllText(StatePath);
        if (Num(j, "size") == Size && Num(j, "segment") == SegmentSize && Str(j, "sha256") == Sha.ToUpperInvariant()) {
          foreach (Match m in Regex.Matches(Str(j, "done"), @"\d+")) { int k = int.Parse(m.Value); if (k < segCount && !done[k]) { done[k] = true; doneBytes += SegLen(k); } }
        }
      }
    } catch { }
    Resumed = doneBytes;
    if (doneBytes == 0) {
      for (int i = 0; ; i++) {
        try { using (FileStream f = new FileStream(Part, FileMode.Create, FileAccess.Write, FileShare.ReadWrite)) f.SetLength(Size); break; }
        catch (IOException) { if (i >= 30) throw; Thread.Sleep(500); }
      }
      TryDelete(StatePath);
    } else Log("resume: " + doneBytes + " of " + Size + " bytes already here");
    pending.Clear();
    for (int i = 0; i < segCount; i++) if (!done[i]) pending.AddLast(i);
  }
  void SaveState() {
    StringBuilder d = new StringBuilder();
    for (int i = 0; i < segCount; i++) if (done[i]) { if (d.Length > 0) d.Append(','); d.Append(i); }
    try { File.WriteAllText(StatePath, "{\"size\":" + Size + ",\"segment\":" + SegmentSize + ",\"sha256\":\"" + Sha.ToUpperInvariant() + "\",\"done\":\"" + d + "\"}"); } catch { }
  }
  static long Num(string j, string k) { Match m = Regex.Match(j, "\"" + k + "\"\\s*:\\s*(\\d+)"); return m.Success ? long.Parse(m.Groups[1].Value) : -1; }
  static string Str(string j, string k) { Match m = Regex.Match(j, "\"" + k + "\"\\s*:\\s*\"([^\"]*)\""); return m.Success ? m.Groups[1].Value : ""; }
  long SegLen(int k) { return Math.Min(Size, (long)(k + 1) * SegmentSize) - (long)k * SegmentSize; }
  static void TryDelete(string p) { try { if (File.Exists(p)) File.Delete(p); } catch { } }

  /* ---------- parallel probe ---------- */
  HttpWebRequest Make(string url) {
    HttpWebRequest r = (HttpWebRequest)WebRequest.Create(url);
    r.UserAgent = UserAgent; r.Timeout = StallMs; r.ReadWriteTimeout = StallMs; r.KeepAlive = true;
    return r;
  }
  static int StatusOf(WebException e) { HttpWebResponse r = e.Response as HttpWebResponse; return r == null ? 0 : (int)r.StatusCode; }
  static long TotalFromContentRange(string cr) { if (cr == null) return -1; Match m = Regex.Match(cr, @"/(\d+)"); return m.Success ? long.Parse(m.Groups[1].Value) : -1; }

  void Probe() {
    Phase = "probe";
    List<HttpWebRequest> reqs = new List<HttpWebRequest>();
    List<Thread> threads = new List<Thread>();
    DateTime start = DateTime.UtcNow;
    int running = Sources.Count;
    foreach (MeguSource src in Sources) {
      MeguSource s = src;
      HttpWebRequest req = Make(s.Url); req.Timeout = ProbeCapMs; req.ReadWriteTimeout = ProbeCapMs; req.AddRange(0L);
      lock (reqs) reqs.Add(req);
      Thread t = new Thread(delegate() {
        try {
          using (HttpWebResponse res = (HttpWebResponse)req.GetResponse()) {
            s.Live = res.ResponseUri.AbsoluteUri;
            if ((int)res.StatusCode == 206) { s.Range = 1; s.Length = TotalFromContentRange(res.Headers["Content-Range"]); }
            else { s.Range = 0; s.Length = res.ContentLength; }
            Stream st = res.GetResponseStream(); byte[] buf = new byte[65536];
            while ((DateTime.UtcNow - start).TotalMilliseconds < ProbeMs && Interlocked.Read(ref s.ProbeBytes) < ProbeMaxBytes) {
              int n = st.Read(buf, 0, buf.Length); if (n <= 0) break; Interlocked.Add(ref s.ProbeBytes, n);
            }
            double sec = Math.Max(0.05, (DateTime.UtcNow - start).TotalSeconds);
            s.ProbeSpeed = s.ProbeBytes / sec;
          }
        } catch (WebException e) {
          int code = StatusOf(e);
          if (code >= 400) { s.Dead = true; s.Why = "HTTP " + code; }
          else if (s.ProbeBytes > 0) s.ProbeSpeed = s.ProbeBytes / Math.Max(0.05, (DateTime.UtcNow - start).TotalSeconds);
          else s.Why = e.Status.ToString();
        } catch (Exception e) { if (s.ProbeBytes == 0) s.Why = e.Message; }
        finally { try { req.Abort(); } catch { } Interlocked.Decrement(ref running); }
      });
      t.IsBackground = true; threads.Add(t); t.Start();
    }
    while (running > 0 && !cancel && (DateTime.UtcNow - start).TotalMilliseconds < ProbeMs + 150) Thread.Sleep(30);
    /* A source still connecting or mid-read gets scored on what it managed so far, then its request is dropped. */
    foreach (MeguSource s in Sources) if (s.ProbeSpeed == 0 && s.ProbeBytes > 0) s.ProbeSpeed = s.ProbeBytes / Math.Max(0.05, (DateTime.UtcNow - start).TotalSeconds);
    lock (reqs) foreach (HttpWebRequest r in reqs) { try { r.Abort(); } catch { } }
    foreach (Thread t in threads) t.Join(Math.Max(0, ProbeCapMs - (int)(DateTime.UtcNow - start).TotalMilliseconds));
    ProbeElapsedMs = (long)(DateTime.UtcNow - start).TotalMilliseconds;
    foreach (MeguSource s in Sources) {
      if (!s.Dead && Size > 0 && s.Length > 0 && s.Length != Size) { s.Dead = true; s.Why = "size " + s.Length; }
      s.Speed = s.ProbeSpeed;
      Log(string.Format("probe {0}: {1:0.00} MB/s range={2}{3}", s.Host, s.ProbeSpeed / 1048576, s.Range, s.Dead ? " dead " + s.Why : (s.Why != null ? " (" + s.Why + ")" : "")));
    }
  }

  /* ---------- segmented download ---------- */
  bool HasRangeSource() { lock (gate) { foreach (MeguSource s in Sources) if (!s.Dead && s.Range != 0) return true; return false; } }
  double BestSpeed() { double b = 0; foreach (MeguSource s in Sources) if (!s.Dead && s.Range != 0 && s.Speed > b) b = s.Speed; return b; }
  /* Fast sources take more connections; a source far slower than the best one is left alone. Caller holds gate. */
  MeguSource Pick() {
    double best = BestSpeed(); MeguSource pick = null; double score = -1;
    foreach (MeguSource s in Sources) {
      if (s.Dead || s.Range == 0 || s.Active >= MaxPerSource) continue;
      if (s.Speed < best * SlowRatio) continue;
      double sc = s.Speed / (1 + 0.6 * s.Active);
      if (sc > score || (sc == score && pick != null && s.Order < pick.Order)) { score = sc; pick = s; }
    }
    return pick;
  }
  bool OthersAlive(MeguSource me) { foreach (MeguSource s in Sources) if (s != me && !s.Dead && s.Range != 0) return true; return false; }
  int Busy() { int n = 0; foreach (MeguSource s in Sources) n += s.Active; return n; }
  void Kill(MeguConn c, string why) {
    if (c.Killed) return; c.KillWhy = why; c.Killed = true;
    HttpWebRequest r = c.Req; if (r != null) { try { r.Abort(); } catch { } }
  }

  void Segmented() {
    int workers = Math.Min(Connections, Math.Max(1, pending.Count));
    List<Thread> ts = new List<Thread>();
    for (int i = 0; i < workers; i++) { Thread t = new Thread(Worker); t.IsBackground = true; ts.Add(t); t.Start(); }
    DateTime win = DateTime.UtcNow; long winDone = doneBytes;
    while (true) {
      bool alive = false; foreach (Thread t in ts) if (t.IsAlive) alive = true;
      if (!alive) break;
      Thread.Sleep(250);
      lock (gate) {
        DateTime now = DateTime.UtcNow;
        double sec = (now - win).TotalSeconds;
        if (sec >= 2) {
          long rec = doneBytes; foreach (MeguConn c in conns) rec += c.Got;
          TotalSpeed = Math.Max(0, rec - winDone) / sec; winDone = rec;
          foreach (MeguSource s in Sources) { s.Recent = s.WinBytes; s.WinBytes = 0; }
          foreach (MeguConn c in conns) { c.RecentSpeed = c.WinGot / Math.Max(0.25, (now - (c.Started > win ? c.Started : win)).TotalSeconds); c.WinGot = 0; }
          win = now;
        }
        /* Average per-connection speed over the last window, finished segments included. */
        int n = conns.Count; double avg = n > 0 ? TotalSpeed / n : 0;
        foreach (MeguConn c in conns) {
          if (c.Killed) continue;
          if ((now - c.LastData).TotalMilliseconds > StallMs) { StallKills++; Kill(c, "stall"); continue; }
          if (n >= 2 && (now - c.Started).TotalMilliseconds > SlowGraceMs && c.RecentSpeed < avg * SlowRatio && c.Len - c.Got > 256 * 1024) { SlowKills++; Kill(c, "slow"); }
        }
      }
    }
    lock (gate) { if (!cancel && doneBytes < Size && failWhy == null && HasRangeSource()) failWhy = "所有下载源都失败了"; }
  }

  void Worker() {
    while (true) {
      MeguConn c;
      lock (gate) {
        while (true) {
          if (cancel || failWhy != null || doneBytes >= Size) { Monitor.PulseAll(gate); return; }
          MeguSource s = Pick();
          if (pending.Count > 0 && s != null) {
            int seg = pending.First.Value; pending.RemoveFirst();
            c = new MeguConn(); c.Src = s; c.Seg = seg; c.Len = SegLen(seg); c.Started = c.LastData = DateTime.UtcNow;
            s.Active++; conns.Add(c); break;
          }
          if (pending.Count == 0 && s != null) Steal(s);
          if (Busy() == 0 && pending.Count > 0 && s == null) { if (!HasRangeSource()) return; failWhy = "所有下载源都失败了"; Monitor.PulseAll(gate); return; }
          if (Busy() == 0 && pending.Count == 0 && doneBytes < Size) return;
          Monitor.Wait(gate, 300);
        }
      }
      Fetch(c);
    }
  }
  /* Tail: nothing left to hand out, so a free connection takes over a segment that a slow one would finish much later. */
  void Steal(MeguSource s) {
    MeguConn worst = null; double worstEta = 0;
    foreach (MeguConn c in conns) {
      if (c.Killed || (DateTime.UtcNow - c.Started).TotalMilliseconds < 2000) continue;
      double eta = (c.Len - c.Got) / Math.Max(1.0, c.RecentSpeed);
      if (eta > worstEta) { worstEta = eta; worst = c; }
    }
    if (worst == null) return;
    double mine = worst.Len / Math.Max(1.0, s.Speed) + 1.0;
    if (worstEta > mine * 1.5) { Steals++; Kill(worst, "steal"); }
  }

  void Fetch(MeguConn c) {
    MeguSource s = c.Src; long start = (long)c.Seg * SegmentSize; string err = null; int code = 0; bool wrongSize = false, noRange = false, timedOut = false;
    string used = s.Live;
    try {
      HttpWebRequest req = Make(used); req.AddRange(start, start + c.Len - 1);
      lock (gate) { if (c.Killed) throw new WebException("killed"); c.Req = req; }
      using (HttpWebResponse res = (HttpWebResponse)req.GetResponse()) {
        if ((int)res.StatusCode != 206) { noRange = true; throw new WebException("no range (HTTP " + (int)res.StatusCode + ")"); }
        string cr = res.Headers["Content-Range"] ?? "";
        Match m = Regex.Match(cr, @"bytes\s+(\d+)-(\d+)/(\d+)");
        if (!m.Success || long.Parse(m.Groups[1].Value) != start || long.Parse(m.Groups[2].Value) != start + c.Len - 1 || long.Parse(m.Groups[3].Value) != Size) { wrongSize = true; throw new WebException("bad Content-Range " + cr); }
        s.Live = res.ResponseUri.AbsoluteUri;
        using (Stream st = res.GetResponseStream())
        using (FileStream f = new FileStream(Part, FileMode.Open, FileAccess.Write, FileShare.ReadWrite, 1 << 16)) {
          f.Seek(start, SeekOrigin.Begin); byte[] buf = new byte[65536];
          while (true) {
            int n = st.Read(buf, 0, (int)Math.Min(buf.Length, c.Len - c.Got)); if (n <= 0) break;
            f.Write(buf, 0, n);
            lock (gate) { c.Got += n; c.WinGot += n; s.WinBytes += n; s.Bytes += n; c.LastData = DateTime.UtcNow; }
            if (c.Got >= c.Len) break;
          }
          f.Flush(true);
        }
        if (c.Got != c.Len) throw new WebException("short read");
      }
    } catch (WebException e) { err = e.Message; code = StatusOf(e); timedOut = e.Status == WebExceptionStatus.Timeout; }
    catch (Exception e) { err = e.Message; }
    lock (gate) {
      s.Active--; conns.Remove(c);
      double sec = Math.Max(0.05, (DateTime.UtcNow - c.Started).TotalSeconds);
      if (err == null) {
        done[c.Seg] = true; doneBytes += c.Len; SaveState();
        s.Speed = s.Speed <= 0 ? c.Len / sec : s.Speed * 0.6 + (c.Len / sec) * 0.4; s.Range = 1;
      } else {
        pending.AddFirst(c.Seg);
        if (c.Killed) {
          if (c.KillWhy == "slow" || c.KillWhy == "steal") s.Speed = Math.Min(s.Speed, Math.Max(c.RecentSpeed, c.Got / sec));
          if (c.KillWhy == "stall") { s.Speed *= 0.2; s.Strikes++; }
          if (c.KillWhy != "cancel") Log("seg " + c.Seg + " " + c.KillWhy + " on " + s.Host + string.Format(" ({0:0.00} MB/s)", c.RecentSpeed / 1048576));
        } else if (timedOut) { StallKills++; s.Speed *= 0.2; s.Strikes++; Log("seg " + c.Seg + " stall on " + s.Host + " (no data for " + StallMs / 1000 + " s)"); }
        else if (noRange) { s.Range = 0; Log(s.Host + ": no Range support"); }
        else if (wrongSize || code == 404 || code == 403 || code == 410 || code == 416) { s.Dead = true; s.Why = code > 0 ? "HTTP " + code : err; Log(s.Host + " dropped: " + s.Why); }
        else if (used != s.Url) { s.Live = s.Url; Log(s.Host + ": redirect target failed, back to " + s.Url); }
        else { s.Strikes++; s.Speed *= 0.5; Log("seg " + c.Seg + " error on " + s.Host + ": " + err); }
        /* The last working source is given more chances: a short network drop should not end the download. */
        if (!s.Dead && (s.Strikes >= 8 || (s.Strikes >= 3 && OthersAlive(s)))) { s.Dead = true; s.Why = "too many errors"; Log(s.Host + " dropped: " + s.Why); }
      }
      Monitor.PulseAll(gate);
    }
  }

  /* ---------- sources without Range: one connection, whole file ---------- */
  void WholeFile() {
    List<MeguSource> list = new List<MeguSource>();
    foreach (MeguSource s in Sources) if (!s.Dead && s.Range == 0) list.Add(s);
    list.Sort(delegate(MeguSource a, MeguSource b) { int k = b.Speed.CompareTo(a.Speed); return k != 0 ? k : a.Order.CompareTo(b.Order); });
    if (list.Count == 0) return;
    Single = true; failWhy = null;
    foreach (MeguSource s in list) {
      if (cancel) return;
      lock (gate) { doneBytes = 0; for (int i = 0; i < segCount; i++) done[i] = false; pending.Clear(); }
      TryDelete(StatePath);
      MeguConn c = new MeguConn(); c.Src = s; c.Seg = -1; c.Len = Size; c.Started = c.LastData = DateTime.UtcNow;
      lock (gate) { s.Active++; conns.Add(c); }
      string err = null; bool[] over = new bool[1];
      Thread dog = new Thread(delegate() {
        while (!c.Killed && !over[0]) {
          Thread.Sleep(250);
          lock (gate) { if ((DateTime.UtcNow - c.LastData).TotalMilliseconds > StallMs) { StallKills++; Kill(c, "stall"); } TotalSpeed = s.Speed; }
        }
      });
      dog.IsBackground = true; dog.Start();
      try {
        HttpWebRequest req = Make(s.Url);
        lock (gate) { if (c.Killed) throw new WebException("killed"); c.Req = req; }
        using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
        using (Stream st = res.GetResponseStream())
        using (FileStream f = new FileStream(Part, FileMode.Create, FileAccess.Write, FileShare.ReadWrite, 1 << 16)) {
          byte[] buf = new byte[65536];
          while (true) {
            int n = st.Read(buf, 0, buf.Length); if (n <= 0) break;
            f.Write(buf, 0, n);
            lock (gate) { c.Got += n; s.WinBytes += n; s.Bytes += n; c.LastData = DateTime.UtcNow; s.Speed = c.Got / Math.Max(0.05, (DateTime.UtcNow - c.Started).TotalSeconds); }
            if (c.Got > Size) throw new WebException("file larger than expected");
          }
        }
        if (c.Got != Size) throw new WebException("short read");
      } catch (Exception e) { err = c.Killed ? c.KillWhy : e.Message; }
      over[0] = true;
      lock (gate) { s.Active--; conns.Remove(c); if (err == null) { doneBytes = Size; for (int i = 0; i < segCount; i++) done[i] = true; } }
      if (err == null) return;
      Log("whole-file " + s.Host + " failed: " + err);
      if (cancel) return;
      s.Dead = true; s.Why = err;
    }
    failWhy = "所有下载源都失败了";
  }

  string Hash() {
    for (int i = 0; ; i++) {
      try {
        using (FileStream f = new FileStream(Part, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 1 << 20))
        using (SHA256 h = SHA256.Create()) return BitConverter.ToString(h.ComputeHash(f)).Replace("-", "");
      } catch (IOException) { if (i >= 30) throw; Thread.Sleep(500); }
    }
  }
}
'@
function Ensure-Engine { if (-not ('MeguFetch' -as [type])) { Add-Type -TypeDefinition $fetchSource } }

# Resolve the chosen folder; copy MeguLit there when it is not this folder. Returns $false (and says why) when it cannot.
$script:moved = $false
function Use-Target {
  $raw = $pathBox.Text.Trim().Trim('"')
  try { $target = [IO.Path]::GetFullPath($raw).TrimEnd('\') } catch { $target = $null }
  if (-not $raw -or -not $target -or -not [IO.Path]::IsPathRooted($raw)) { [void][Windows.Forms.MessageBox]::Show($form, '请填写完整的安装位置，例如 D:\MeguLit', 'MeguLit'); return $false }
  if ($target -ieq $sourceRoot) { return $true }
  if ($target.StartsWith($sourceRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { [void][Windows.Forms.MessageBox]::Show($form, '安装位置不能放在当前 MeguLit 文件夹里面，换一个位置吧', 'MeguLit'); return $false }
  if ((Test-Path $target) -and -not (Test-Path (Join-Path $target 'MeguLit.exe')) -and @(Get-ChildItem -Force $target -ErrorAction SilentlyContinue).Count -gt 0) { $target = Join-Path $target 'MeguLit' }
  try {
    New-Item -ItemType Directory -Force $target -ErrorAction Stop | Out-Null
    $probe = Join-Path $target ('.megulit-write-' + $PID); [IO.File]::WriteAllText($probe, 'ok'); Remove-Item $probe -Force
  } catch { [void][Windows.Forms.MessageBox]::Show($form, ('这个位置不能写入：' + $target + "`n换一个位置吧，例如 D:\MeguLit（Program Files 需要管理员权限）"), 'MeguLit'); return $false }
  $choice.Visible = $false; $progress.Visible = $true; $button.Enabled = $false
  $title.Text = '正在复制 MeguLit…'; $status.ForeColor = $C.muted; $status.Text = ('正在把 MeguLit 复制到 ' + $target); $whereLabel.Text = '安装位置：' + $target; Set-Busy; $form.Refresh()
  $copyArgs = @("`"$sourceRoot`"", "`"$target`"", '/E', '/R:2', '/W:1', '/NP', '/NFL', '/NDL', '/NJH', '/NJS', '/XD', "`"$sourceRoot\logs`"", "`"$sourceRoot\cache`"", 'runtime-*.unpack', '/XF', 'runtime-*.part*')
  $copy = Start-Process -FilePath "$env:SystemRoot\System32\robocopy.exe" -ArgumentList $copyArgs -WindowStyle Hidden -PassThru
  $null = $copy.Handle
  while (-not $copy.HasExited) { [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 30 }
  $copy.WaitForExit(); $button.Enabled = $true
  if ($copy.ExitCode -ge 8 -or -not (Test-Path (Join-Path $target 'MeguLit.exe'))) {
    Set-Bar 0; $choice.Visible = $true; $progress.Visible = $false
    [void][Windows.Forms.MessageBox]::Show($form, ('复制到 ' + $target + ' 没成功（robocopy ' + $copy.ExitCode + '），检查磁盘空间后再试一次'), 'MeguLit'); return $false
  }
  $script:Root = $target; $script:runtimeDir = Join-Path $target 'runtime'; $script:moved = $true
  return $true
}
function Make-Shortcuts {
  $exePath = Join-Path $Root 'MeguLit.exe'
  if (-not (Test-Path $exePath)) { return }
  $places = @(); if ($deskCheck.Checked) { $places += [Environment]::GetFolderPath('Desktop') }; if ($menuCheck.Checked) { $places += [Environment]::GetFolderPath('Programs') }
  foreach ($dir in $places) {
    if (-not $dir) { continue }
    try {
      $sh = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $dir 'MeguLit.lnk'))
      $sh.TargetPath = $exePath; $sh.WorkingDirectory = $Root; $sh.IconLocation = $exePath + ',0'; $sh.Description = 'MeguLit'; $sh.Save()
    } catch {}
  }
  # The uninstaller sits next to the app's Start menu entry (only when the user asked for one).
  $un = Join-Path $Root 'setup\uninstall.ps1'
  if ($menuCheck.Checked -and (Test-Path $un)) {
    try {
      $sh = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Programs')) 'Uninstall MeguLit.lnk'))
      $sh.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
      $sh.Arguments = "-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File `"$un`" -Root `"$Root`""
      $sh.WorkingDirectory = $Root; $sh.IconLocation = $exePath + ',0'; $sh.Description = 'Uninstall MeguLit / 卸载 MeguLit'; $sh.WindowStyle = 7; $sh.Save()
    } catch {}
  }
}
# Apps & features entry (HKCU, no admin). setup\uninstall.ps1 removes it again; MeguLit refreshes it after a move or update.
function Register-Uninstall {
  $un = Join-Path $Root 'setup\uninstall.ps1'; $exePath = Join-Path $Root 'MeguLit.exe'
  if (-not (Test-Path $un) -or -not (Test-Path $exePath)) { return }
  try {
    $version = ''; $about = Join-Path $Root 'web\about.js'; if (Test-Path $about) { $m = [regex]::Match((Get-Content -Raw -Encoding UTF8 $about), "VERSION='([^']+)'"); if ($m.Success) { $version = $m.Groups[1].Value } }
    $k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MeguLit'
    New-Item -Path $k -Force | Out-Null
    $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $vals = @{ DisplayName = 'MeguLit'; DisplayIcon = $exePath + ',0'; DisplayVersion = $version; Publisher = 'ilynthn'; InstallLocation = $Root; URLInfoAbout = 'https://megulit.com'
      UninstallString = "`"$ps`" -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File `"$un`" -Root `"$Root`"" }
    foreach ($n in $vals.Keys) { Set-ItemProperty -Path $k -Name $n -Value $vals[$n] }
    foreach ($n in 'NoModify','NoRepair') { New-ItemProperty -Path $k -Name $n -Value 1 -PropertyType DWord -Force | Out-Null }
  } catch {}
}
function Start-Install($ids) {
  if (-not (Use-Target)) { return }
  $whereLabel.Text = '安装位置：' + $runtimeDir
  $script:queue = @($ids | Where-Object { $id = $_; @($markers[$id] | Where-Object { -not (Test-Path (Join-Path $Root $_)) }).Count -gt 0 })
  $script:index = 0; $choice.Visible = $false; $progress.Visible = $true; Next-Pack
}
function Current { $script:queue[$script:index] }
# One stable file per pack so Retry or the next launch can resume it (the downloader waits out antivirus locks).
# Unpack folders still get a fresh name per attempt. ".setup.part" keeps clear of the app's own runtime-<id>.part.
$script:attempt = 0
function Part { Join-Path $Root ('runtime-' + (Current) + '.setup.part') }
# Remove/move with patience: retry for ~15 s while another process (antivirus, indexer, an old
# MeguLit still running) holds the file, instead of failing the whole install on the first try.
function With-Retry([scriptblock]$op) {
  for ($i = 0; ; $i++) {
    try { & $op; return }
    catch {
      if ($i -ge 30) { throw }
      $until = [DateTime]::Now.AddMilliseconds(500)
      while ([DateTime]::Now -lt $until) { [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 30 }
    }
  }
}
# Processes started from this install's own runtime folder (node / aivis from an earlier MeguLit run)
# lock the files we are about to replace. Only processes inside $runtimeDir are touched.
function Stop-RuntimeProcesses {
  $prefix = [IO.Path]::GetFullPath($runtimeDir).TrimEnd('\') + '\'
  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { try { $_.Kill(); $_.WaitForExit(3000) | Out-Null } catch {} }
}
function Next-Pack {
  if ($script:index -ge $script:queue.Count) { $script:done = $true; $form.Close(); return }
  Start-Download
}
$poll = New-Object Windows.Forms.Timer; $poll.Interval = 200
function Start-Download {
  $script:stage = 'download'; $script:mode = 'download'; $button.Text = '取消 Cancel'; Style-Button $button $false; $button.FlatAppearance.BorderColor = $C.red; $status.ForeColor = $C.muted; Set-Bar 0
  $title.Text = '正在下载运行组件…'
  $status.Text = ('[{0}/{1}] {2}：正在同时测速所有下载源（GitHub / 国内镜像），挑最快的几个一起下载…' -f ($script:index+1), $script:queue.Count, $names[(Current)]); $form.Refresh()
  try { Ensure-Engine } catch { Fail ('下载组件加载失败：' + $_.Exception.Message); return }
  $f = New-Object MeguFetch
  $f.Urls = [string[]]@(Candidates (Current)); $f.Part = Part; $f.Size = [long]$packs.(Current).size; $f.Sha = [string]$packs.(Current).sha256
  $script:fetch = $f; $f.Start(); $poll.Start()
}
function Fail([string]$message) {
  $script:mode = 'failed'; $status.ForeColor = $C.red; Set-Bar 0
  $title.Text = if ($script:stage -eq 'unpack') { '安装没完成' } else { '下载中断了' }
  $hint = if ($script:stage -eq 'unpack') { '磁盘空间不足或文件被占用时会这样，点「重试」再来一次 / Retry' } else { '检查网络后点「重试」，已下载的部分会接着用 / Check your connection and retry' }
  $status.Text = $message + "`n" + $hint; $button.Text = '重试 Retry'; Style-Button $button $true
}
$poll.add_Tick({
  $f = $script:fetch; if (-not $f) { $poll.Stop(); return }
  $head = '[{0}/{1}] ' -f ($script:index+1), $script:queue.Count
  switch ($f.Phase) {
    'download' {
      $got = $f.Received; Set-Bar ([int][math]::Min(1000, 1000 * $got / [math]::Max(1, $f.Size)))
      $speed = if ($f.TotalSpeed -gt 0) { '  ·  {0:N1} MB/s' -f ($f.TotalSpeed / 1MB) } else { '' }
      $src = $f.SourceLabel(); $from = if ($src) { '  ·  来源 ' + $src } else { '' }
      $resumed = if ($f.Resumed -gt 0) { '（接着上次）' } else { '' }
      $status.Text = $head + ('正在下载{0}{1}  {2:N0} / {3:N0} MB{4}{5}' -f $names[(Current)], $resumed, ($got/1MB), ($f.Size/1MB), $speed, $from)
    }
    'verify' { Set-Bar 1000; $status.Text = $head + '正在校验… / Verifying' }
    'done' { $poll.Stop(); $script:fetch = $null; Save-FetchLog $f; Install-Pack $f.Part }
    'failed' { $poll.Stop(); $script:fetch = $null; Save-FetchLog $f; Fail ('下载失败：' + $f.Error) }
  }
})
# Probe results and every dropped connection go to logs\setup-download.log, so a "slow download" report can be read.
function Save-FetchLog($f) {
  try { $d = Join-Path $Root 'logs'; New-Item -ItemType Directory -Force $d | Out-Null; Add-Content -Encoding UTF8 (Join-Path $d 'setup-download.log') ("== " + (Get-Date -Format s) + " " + (Current) + " " + $f.Phase + "`r`n" + $f.LogText()) } catch {}
}
function Install-Pack([string]$part) {
  try {
    $script:attempt++; $unpack = Join-Path $Root ('runtime-' + (Current) + '-' + $script:attempt + '.unpack')
    $script:stage = 'unpack'
    $status.Text = ('正在解压{0}… / Unpacking' -f $names[(Current)]); Set-Busy; $form.Refresh()
    if (Test-Path $unpack) { With-Retry { Remove-Item $unpack -Recurse -Force -ErrorAction Stop } }
    New-Item -ItemType Directory $unpack | Out-Null
    $tar = Start-Process -FilePath "$env:SystemRoot\System32\tar.exe" -ArgumentList @('-xf', "`"$part`"", '-C', "`"$unpack`"") -NoNewWindow -PassThru
    $null = $tar.Handle  # keep the handle so ExitCode is readable after exit
    while (-not $tar.HasExited) { [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 30 }
    $tar.WaitForExit()
    if ($tar.ExitCode -ne 0 -or -not (Test-Path (Join-Path $unpack 'runtime'))) { throw '解压失败' }
    New-Item -ItemType Directory -Force $runtimeDir | Out-Null
    Stop-RuntimeProcesses
    Get-ChildItem (Join-Path $unpack 'runtime') | ForEach-Object {
      $src = $_.FullName; $dest = Join-Path $runtimeDir $_.Name
      if (Test-Path $dest) { With-Retry { Remove-Item $dest -Recurse -Force -ErrorAction Stop } }
      With-Retry { Move-Item $src $dest -ErrorAction Stop }
    }
    # Leftovers are harmless; never fail an install that already succeeded over a temp file.
    try { Remove-Item $unpack -Recurse -Force -ErrorAction Stop } catch {}
    try { Remove-Item $part, ($part + '.json') -Force -ErrorAction SilentlyContinue } catch {}
    $script:index++; Next-Pack
  } catch { Fail ('安装失败：' + $_.Exception.Message) }
}

$button.add_Click({
  if ($script:mode -eq 'failed') { Start-Download }
  else { if ($script:fetch) { $poll.Stop(); $script:fetch.Cancel() }; $form.Close() }
})
$form.add_FormClosing({ if (-not $script:done -and $script:fetch) { $poll.Stop(); $script:fetch.Cancel() } })
# MEGULIT_SETUP_PREVIEW=<png>: render the choice page to an image and exit (used to check the layout).
if ($env:MEGULIT_SETUP_PREVIEW) { $form.add_Shown({ if ($env:MEGULIT_SETUP_PREVIEW_STATE -eq 'failed') { $choice.Visible = $false; $progress.Visible = $true; $script:stage = 'download'; Fail '下载失败：无法连接到服务器' }; if ($env:MEGULIT_SETUP_PREVIEW_STATE -eq 'progress') { $choice.Visible = $false; $progress.Visible = $true; $status.Text = '[1/3] 正在下载基础组件  47 / 107 MB  ·  6.8 MB/s  ·  来源 cn-dl.megulit.com 等 3 个源'; Set-Bar 440 }; $form.Refresh(); $bmp = New-Object Drawing.Bitmap $form.Width, $form.Height; $form.DrawToBitmap($bmp, (New-Object Drawing.Rectangle 0,0,$form.Width,$form.Height)); $bmp.Save($env:MEGULIT_SETUP_PREVIEW); $form.Close() }) }
# MEGULIT_SETUP_AUTOSTART=lite|full: press the install button at once (end-to-end test on a hidden desktop).
if ($env:MEGULIT_SETUP_AUTOSTART -and -not $env:MEGULIT_SETUP_PREVIEW) { $form.add_Shown({ Start-Install $(if ($env:MEGULIT_SETUP_AUTOSTART -eq 'full') { $full } else { $lite }) }) }
[void]$form.ShowDialog()
if ($script:fetch) { $script:fetch.Cancel(); [void]$script:fetch.Wait(3000) }
# runtime-<id>.setup.part(.json) stay for resuming; only the per-attempt files of older setups are swept.
Get-ChildItem $Root -Filter 'runtime-*.part' -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^runtime-[a-z]+-\d+\.part$' } | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem $Root -Directory -Filter 'runtime-*.unpack' -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
if ($script:done -and (Test-Path (Join-Path $Root 'runtime\node.exe'))) {
  Make-Shortcuts
  Register-Uninstall
  # Installed somewhere else: start that copy (its own single-instance lock) and tell this exe to quit (exit 3 = not ready here).
  if ($script:moved) { Start-Process -FilePath (Join-Path $Root 'MeguLit.exe') -WorkingDirectory $Root; exit 3 }
  exit 0
} else { exit 1 }
