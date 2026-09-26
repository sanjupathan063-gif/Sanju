package com.sanju.app;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import java.util.Set;

public class TtsPlugin {
    private TextToSpeech tts;
    
    // Set female voice natively
    public void setFemaleVoice() {
        if (tts != null) {
            Set<Voice> voices = tts.getVoices();
            for (Voice v : voices) {
                if (v.getName().toLowerCase().contains("female")) {
                    tts.setVoice(v);
                    break;
                }
            }
        }
    }
    
    // Clean asterisks before speaking
    public void speakCleanText(String text) {
        String cleanText = text.replaceAll("[*#_]", "");
        tts.speak(cleanText, TextToSpeech.QUEUE_FLUSH, null, null);
    }
}
