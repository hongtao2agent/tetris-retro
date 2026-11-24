"""Generate bundled Gemini TTS voices. Requires GEMINI_API_KEY and ffmpeg.

The API key stays in the environment and is never shipped to the game.
Use --output-dir to audition clips before replacing the published assets.
"""
import argparse
import base64
import json
import os
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def generate(key, transcript, manifest, output_dir, opener, api_key):
    model = manifest.get('model_overrides', {}).get(key, manifest['model'])
    style = manifest['style']
    if key.startswith('clear-'):
        style += ' ' + manifest['variant_styles'][key.rsplit('-', 1)[1]]
    payload = {
        'contents': [{'role': 'user', 'parts': [
            {'text': transcript, 'speech_metadata': {'style': style}}
        ]}],
        'generationConfig': {
            'responseModalities': ['AUDIO'],
            'speechConfig': {'voiceConfig': {'voice': manifest['voice']}}
        }
    }
    request = urllib.request.Request(
        'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
        data=json.dumps(payload).encode(),
        headers={'x-goog-api-key': api_key, 'Content-Type': 'application/json'},
        method='POST')
    for attempt in range(3):
        try:
            with opener.open(request, timeout=90) as response:
                result = json.load(response)
            break
        except urllib.error.HTTPError as error:
            if error.code == 429:
                details = json.load(error).get('error', {}).get('details', [])
                if any('PerDay' in violation.get('quotaId', '')
                       for detail in details for violation in detail.get('violations', [])):
                    raise RuntimeError(key + ': daily free quota exhausted for ' + model) from None
            if error.code in (429, 500, 503) and attempt < 2:
                print(key + ': temporary HTTP ' + str(error.code) + ', retrying', flush=True)
                time.sleep(35 + 10 * attempt)
                continue
            raise RuntimeError(key + ': Gemini returned HTTP ' + str(error.code)) from None
    parts = result.get('candidates', [{}])[0].get('content', {}).get('parts', [])
    audio = next((part['inlineData'] for part in parts if part.get('inlineData', {}).get('mimeType', '').startswith('audio/')), None)
    if not audio:
        raise RuntimeError(key + ': Gemini did not return audio')
    data = base64.b64decode(audio['data'])
    with tempfile.TemporaryDirectory(prefix='graphite-gemini-') as folder:
        source = Path(folder) / 'voice.wav'
        if data.startswith(b'RIFF'):
            source.write_bytes(data)
        else:
            with wave.open(str(source), 'wb') as wav:
                wav.setnchannels(1)
                wav.setsampwidth(2)
                wav.setframerate(24000)
                wav.writeframes(data)
        output = output_dir / (key + '.m4a')
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source),
                        '-af', 'silenceremove=start_periods=1:start_duration=0.04:start_threshold=-48dB,loudnorm=I=-18:TP=-2:LRA=7',
                        '-codec:a', 'aac', '-b:a', '96k', '-ar', '24000', str(output)], check=True)
        info = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
                          'format=duration,size', '-of', 'json', str(output)]))['format']
        if not .3 < float(info.get('duration', 0)) < 12:
            raise RuntimeError(key + ': invalid clip duration')
        print(key + ': ' + info['duration'] + ' seconds', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only', nargs='+', help='Render only the named cues')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'audio')
    parser.add_argument('--interval', type=float, default=24, help='Seconds between requests to avoid API rate limits')
    args = parser.parse_args()
    api_key = os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')
    if not api_key:
        parser.error('Set GEMINI_API_KEY in the environment')
    manifest = json.loads((ROOT / 'audio/manifest.json').read_text())
    proxy = os.environ.get('TTS_PROXY_URL')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({'https': proxy}) if proxy else urllib.request.ProxyHandler())
    args.output_dir.mkdir(parents=True, exist_ok=True)
    selected = [(key, text) for key, text in manifest['lines'].items() if not args.only or key in args.only]
    for i, (key, transcript) in enumerate(selected):
        generate(key, transcript, manifest, args.output_dir, opener, api_key)
        if i < len(selected) - 1:
            time.sleep(max(0, min(50, args.interval)))


if __name__ == '__main__':
    main()
