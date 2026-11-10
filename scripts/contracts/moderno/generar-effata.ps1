# Recorta el sello Effata del banner original de la promesa y le quita el fondo negro,
# para usarlo sobre papel blanco en el membrete de la copia rediseñada.
Add-Type -AssemblyName System.Drawing
$dir = $PSScriptRoot
$src = [System.Drawing.Bitmap]::FromFile((Join-Path $dir 'fuente-banner-promesa.jpg'))
$crop = New-Object System.Drawing.Rectangle 28, 34, 90, 76
$scale = 4
$W = $crop.Width * $scale; $H = $crop.Height * $scale
$bmp = New-Object System.Drawing.Bitmap $W, $H, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
$g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $W, $H), $crop, 'Pixel')
$g.Dispose(); $src.Dispose()

# Relleno desde los bordes: solo se vuelve transparente el negro conectado con el exterior del sello.
$threshold = 60
$bright = { param($x, $y) $c = $bmp.GetPixel($x, $y); [math]::Max($c.R, [math]::Max($c.G, $c.B)) }
$seen = New-Object 'bool[,]' $W, $H
$queue = New-Object System.Collections.Generic.Queue[int[]]
for ($x = 0; $x -lt $W; $x++) { $queue.Enqueue(@($x, 0)); $queue.Enqueue(@($x, ($H - 1))) }
for ($y = 0; $y -lt $H; $y++) { $queue.Enqueue(@(0, $y)); $queue.Enqueue(@(($W - 1), $y)) }
while ($queue.Count) {
  $p = $queue.Dequeue(); $x = $p[0]; $y = $p[1]
  if ($x -lt 0 -or $y -lt 0 -or $x -ge $W -or $y -ge $H -or $seen[$x, $y]) { continue }
  $seen[$x, $y] = $true
  if ((& $bright $x $y) -ge $threshold) { continue }
  $bmp.SetPixel($x, $y, [System.Drawing.Color]::Transparent)
  $queue.Enqueue(@(($x + 1), $y)); $queue.Enqueue(@(($x - 1), $y)); $queue.Enqueue(@($x, ($y + 1))); $queue.Enqueue(@($x, ($y - 1)))
}
$bmp.Save((Join-Path $dir 'effata.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
