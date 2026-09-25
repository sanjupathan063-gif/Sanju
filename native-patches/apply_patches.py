#!/usr/bin/env python3
"""
Runs in GitHub Actions after `npx cap add android`.
Copies the custom PhoneControl plugin + MainActivity into the generated
Android project, and adds the permissions/queries it needs to the manifest.
"""
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ANDROID_JAVA_DIR = ROOT / "android" / "app" / "src" / "main" / "java" / "com" / "sanju" / "assistant"
MANIFEST_PATH = ROOT / "android" / "app" / "src" / "main" / "AndroidManifest.xml"
PATCH_DIR = Path(__file__).resolve().parent

def copy_java_files():
    ANDROID_JAVA_DIR.mkdir(parents=True, exist_ok=True)
    for filename in ("PhoneControlPlugin.java", "VoiceInputPlugin.java", "MainActivity.java"):
        src = PATCH_DIR / filename
        dst = ANDROID_JAVA_DIR / filename
        shutil.copyfile(src, dst)
        print(f"Copied {filename} -> {dst}")

def patch_manifest():
    text = MANIFEST_PATH.read_text(encoding="utf-8")

    permissions = (
        '    <uses-permission android:name="android.permission.CALL_PHONE" />\n'
        '    <uses-permission android:name="android.permission.SEND_SMS" />\n'
        '    <uses-permission android:name="android.permission.RECORD_AUDIO" />\n'
        '    <uses-permission android:name="com.android.alarm.permission.SET_ALARM" />\n'
    )
    queries_block = (
        "    <queries>\n"
        "        <intent>\n"
        '            <action android:name="android.intent.action.MAIN" />\n'
        "        </intent>\n"
        "    </queries>\n"
    )

    if "android.permission.CALL_PHONE" not in text:
        text = re.sub(r"(<manifest[^>]*>\n)", r"\1" + permissions, text, count=1)
    if "<queries>" not in text:
        text = re.sub(r"(<manifest[^>]*>\n)", r"\1" + queries_block, text, count=1)

    MANIFEST_PATH.write_text(text, encoding="utf-8")
    print("Patched AndroidManifest.xml with phone-control permissions")

if __name__ == "__main__":
    copy_java_files()
    patch_manifest()
