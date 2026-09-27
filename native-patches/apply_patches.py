#!/usr/bin/env python3
import os
import shutil
import re

def apply_android_patches():
    print("Applying Sanju Assistant Native Patches...")
    
    # 1. Android source destination
    dest_dir = "android/app/src/main/java/com/sanju/voiceassistant"
    plugins_dest = os.path.join(dest_dir, "plugins")
    os.makedirs(plugins_dest, exist_ok=True)
    
    # Copy MainActivity
    if os.path.exists("native-patches/MainActivity.java"):
        shutil.copy("native-patches/MainActivity.java", os.path.join(dest_dir, "MainActivity.java"))
        print("Copied MainActivity.java")
        
    # Copy Plugins
    for plugin in ["PhoneControlPlugin.java", "VoiceInputPlugin.java", "TtsPlugin.java"]:
        src_path = os.path.join("native-patches", plugin)
        if os.path.exists(src_path):
            shutil.copy(src_path, os.path.join(plugins_dest, plugin))
            print(f"Copied {plugin}")
            
    # Inject permissions into AndroidManifest.xml
    manifest_path = "android/app/src/main/AndroidManifest.xml"
    if os.path.exists(manifest_path):
        with open(manifest_path, "r", encoding="utf-8") as f:
            content = f.read()
            
        permissions = [
            '<uses-permission android:name="android.permission.RECORD_AUDIO" />',
            '<uses-permission android:name="android.permission.CALL_PHONE" />',
            '<uses-permission android:name="android.permission.INTERNET" />',
            '<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
            '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
            '<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />'
        ]
        
        for perm in permissions:
            if perm not in content:
                content = content.replace("</manifest>", f"    {perm}\n</manifest>")
                
        with open(manifest_path, "w", encoding="utf-8") as f:
            f.write(content)
        print("Injected native Android permissions into AndroidManifest.xml")
        
    print("Patches successfully applied.")

if __name__ == "__main__":
    apply_android_patches()
