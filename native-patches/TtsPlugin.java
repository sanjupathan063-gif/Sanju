package com.sanju.assistant;

import android.speech.tts.TextToSpeech;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;

@CapacitorPlugin(name = "Tts")
public class TtsPlugin extends Plugin {

    private TextToSpeech tts;
    private boolean ready = false;

    @Override
    public void load() {
        super.load();

        tts = new TextToSpeech(getContext(), status -> {
            ready = status == TextToSpeech.SUCCESS;

            if (ready) {
                tts.setSpeechRate(1.0f);
                tts.setPitch(1.0f);
            }
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        String language = call.getString("language", "bn-BD");

        if (text == null || text.trim().isEmpty()) {
            call.reject("Text is empty");
            return;
        }

        if (!ready || tts == null) {
            call.reject("TTS is not ready");
            return;
        }

        getActivity().runOnUiThread(() -> {
            Locale locale;

            if (language.startsWith("bn")) {
                locale = Locale.forLanguageTag("bn-IN");
            } else if (language.startsWith("hi")) {
                locale = Locale.forLanguageTag("hi-IN");
            } else {
                locale = Locale.forLanguageTag("en-IN");
            }

            int result = tts.setLanguage(locale);

            if (result == TextToSpeech.LANG_MISSING_DATA ||
                result == TextToSpeech.LANG_NOT_SUPPORTED) {

                locale = Locale.forLanguageTag("en-IN");
                tts.setLanguage(locale);
            }

            tts.stop();

            tts.speak(
                text,
                TextToSpeech.QUEUE_FLUSH,
                null,
                "SANJU_TTS"
            );

            JSObject ret = new JSObject();
            ret.put("spoken", true);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (tts != null) {
            tts.stop();
        }
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
        super.handleOnDestroy();
    }
}
