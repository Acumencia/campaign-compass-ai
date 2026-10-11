import json, wave
from pathlib import Path
root=Path(__file__).resolve().parents[1]
segments=json.loads((root/'submission/narration.json').read_text(encoding='utf-8'))
for segment in segments:
    filename=root/'submission/recording'/f"{segment['id']}.wav"
    with wave.open(str(filename)) as audio:
        segment['duration']=audio.getnframes()/audio.getframerate()
    segment['wav']=f"recording/{segment['id']}.wav"
(root/'submission/narration-timing.json').write_text(json.dumps(segments,indent=2),encoding='utf-8')
print(json.dumps({'spoken_seconds':sum(s['duration'] for s in segments),'segments':len(segments),'voice':'Microsoft Zira Desktop, synthetic narration'}))
