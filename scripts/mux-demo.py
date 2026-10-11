"""Combine continuous real-browser video with disclosed synthetic narration."""
import argparse, json, subprocess
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('--ffmpeg',required=True,help='Path to an installed FFmpeg with libx264 and AAC encoders')
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
timeline=json.loads((root/'submission/recording-timeline.json').read_text())
output=root/'submission/campaign-compass-demo.mp4'
command=[args.ffmpeg,'-y','-hide_banner','-loglevel','error','-i',str(root/'submission/campaign-compass-demo-raw.webm')]
filters=[]
for index,segment in enumerate(timeline['segments'],1):
    command+=['-i',str(root/'submission'/segment['wav'])]
    filters.append(f"[{index}:a]adelay={round(segment['start']*1000)}:all=1[a{index}]")
inputs=''.join(f'[a{i}]' for i in range(1,len(timeline['segments'])+1))
filters.append(f'{inputs}amix=inputs={len(timeline["segments"])}:duration=longest:normalize=0[audio]')
command+=['-filter_complex',';'.join(filters),'-map','0:v','-map','[audio]','-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-movflags','+faststart','-t',str(timeline['duration']),str(output)]
subprocess.run(command,check=True)
def stamp(seconds):
    ms=round(seconds*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02}.{ms%1000:03}'
vtt=['WEBVTT','']
for index,segment in enumerate(timeline['segments'],1):
    vtt += [str(index),f"{stamp(segment['start'])} --> {stamp(segment['start']+segment['duration'])}",segment['text'],'']
(root/'submission/campaign-compass-demo.vtt').write_text('\n'.join(vtt),encoding='utf-8')
print(json.dumps({'video':str(output),'bytes':output.stat().st_size,'duration_seconds':timeline['duration'],'narration':'Synthetic Microsoft Zira Desktop voice; disclosed at introduction','visuals':'Continuous actual app browser recording, not rendered stills'}))
