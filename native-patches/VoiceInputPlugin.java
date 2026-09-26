package com.sanju.app;

public class VoiceInputPlugin {
    // Starts a Foreground Service so the app listens for "Sanju" in background
    public void startBackgroundListener() {
        // NOTE: Initialize Android Foreground Service here
        // Integrate lightweight offline engine (like Porcupine) for wake-word "Sanju"
        System.out.println("Foreground Service started. Listening for wake word: Sanju");
    }
}
