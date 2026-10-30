// 抓取桌宠窗口画面 → PNG (PrintWindow, ColorKey 层保留键色便于验收)
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const FFI = process.argv[2] ? null : null;

// 用 PowerShell + .NET 抓图（避免 FFI 依赖）
const ps = `
Add-Type -AssemblyName System.Drawing
$pid_ = ${process.argv[2]}
$outdir = '${process.argv[3] || 'D:/TTPlayer/.workbuddy/whaletmp/shots'}'
New-Item -ItemType Directory -Force -Path $outdir | Out-Null
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint flags);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowTextW(IntPtr hWnd, System.Text.StringBuilder s, int n);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$found = @()
$cb = [W+EnumWindowsProc]{
  param($h, $l)
  $p = 0
  [W]::GetWindowThreadProcessId($h, [ref]$p) | Out-Null
  if ($p -eq $pid_ -and [W]::IsWindowVisible($h)) {
    $sb = New-Object System.Text.StringBuilder 256
    [W]::GetWindowTextW($h, $sb, 256) | Out-Null
    $r = New-Object W+RECT
    [W]::GetWindowRect($h, [ref]$r) | Out-Null
    $found += [pscustomobject]@{ H = $h; Title = $sb.ToString(); W = ($r.Right - $r.Left); H2 = ($r.Bottom - $r.Top) }
  }
  return $true
}
[W]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
$i = 0
foreach ($f in $found) {
  $bmp = New-Object System.Drawing.Bitmap($f.W, $f.H2)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  [W]::PrintWindow($f.H, $hdc, 2) | Out-Null
  $g.ReleaseHdc($hdc)
  $g.Dispose()
  $bmp.Save("$outdir/win_$i.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output ("win_$i.png  " + $f.W + "x" + $f.H2 + "  title=" + $f.Title)
  $i++
}
`;

fs.writeFileSync(path.join('D:/TTPlayer/.workbuddy/whaletmp/cap.ps1'), ps, 'utf8');
console.log('ps written');
