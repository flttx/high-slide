param(
  [string]$OutputPath = (Join-Path $PSScriptRoot 'work\walkthrough-narration.wav')
)

$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

Add-Type -AssemblyName System.Speech
$synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
$synth.SelectVoice('Microsoft Zira Desktop')
$synth.Rate = -2
$synth.Volume = 92
$synth.SetOutputToWaveFile($OutputPath)
$synth.Speak(@'
Think back to the kid who believed every waterslide could go on forever. Megalodon Drop is a gift to that restless imagination: one impossible ride above a vast, open ocean.

The journey begins at sixteen hundred and eighty meters. Follow the track as it sweeps through the clouds, then disappears beneath your feet. Eight gaps break up the route. In free fall, steer toward the green landing marker, tuck to gain speed, or spread out to brake. Narrow turns and shifting landing points make each section feel different, while bold riders can cut across the course with shortcuts.

The ocean is more than scenery. Lose control and a megalodon rises from the water. Reach a checkpoint, and you can return to the run after a fall. Catch the next section, keep your momentum, and make it all the way to the dock.

This is a world made for my younger self: one impossible ride, one more chance, and one very large reason not to fall. Megalodon Drop: race the gaps, evade the megalodon.

From above the clouds to the final dock, every gap gives you another chance to choose a new line.

After a spill, the nearest checkpoint returns you to the action. That second chance keeps the ride playful without taking away the danger. From there, find a cleaner line, keep your speed, and aim for the dock.
'@)
$synth.SetOutputToNull()
$synth.Dispose()
Write-Output "Narration saved to $OutputPath"
