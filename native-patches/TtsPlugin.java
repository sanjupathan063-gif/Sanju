package com.sanju.voiceassistant.plugins;

import android.speech.tts.TextToSpeech;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Locale;

@CapacitorPlugin(name = "Tts")
public class TtsPlugin extends Plugin {

    private TextToSpeech textToSpeech;
    private boolean isReady = false;

    @Override
    public void load() {
        textToSpeech = new TextToSpeech(getContext(), status -> {
            if (status == TextToSpeech.SUCCESS) {
                isReady = true;
                textToSpeech.setLanguage(new Locale("bn", "BD"));
            }
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text");
        String lang = call.getString("lang", "bn");

        if (text == null || text.isEmpty()) {
            call.reject("Text cannot be empty");
            return;
        }

        if (!isReady || textToSpeech == null) {
            call.reject("TTS engine is initializing");
            return;
        }

        try {
            if ("bn".equalsIgnoreCase(lang)) {
                textToSpeech.setLanguage(new Locale("bn", "BD"));
            } else {
                textToSpeech.setLanguage(Locale.US);
            }
            textToSpeech.speak(text, TextToSpeech.QUEUE_FLUSH, null, "sanju_tts_id");
            call.resolve(new JSObject().put("success", true));
        } catch (Exception e) {
            call.reject("TTS speak error: " + e.getMessage());
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (textToSpeech != null) {
            textToSpeech.stop();
            textToSpeech.shutdown();
        }
    }
}
