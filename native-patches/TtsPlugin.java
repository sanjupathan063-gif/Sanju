package com.sanju.assistant;

import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;

@CapacitorPlugin(name = "SanjuTts")
public class TtsPlugin extends Plugin implements TextToSpeech.OnInitListener {

    private TextToSpeech tts;
    private boolean ready = false;

    @Override
    public void load() {
        tts = new TextToSpeech(getContext(), this);
    }

    @Override
    public void onInit(int status) {
        ready = (status == TextToSpeech.SUCCESS);
        if (ready) {
            tts.setSpeechRate(1.0f);
            tts.setPitch(1.0f);
        }
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text");
        String lang = call.getString("lang", "bn");
        if (text == null || text.isEmpty()) {
            call.reject("text is required");
            return;
        }
        if (!ready || tts == null) {
            call.reject("TTS not ready");
            return;
        }

        // ভাষা fallback চেইন: চাওয়া ভাষা -> হিন্দি -> ইংরেজি -> ডিভাইসের ডিফল্ট
        Locale[] chain;
        if (lang.startsWith("bn")) {
            chain = new Locale[]{ new Locale("bn", "BD"), new Locale("hi", "IN"), Locale.US };
        } else if (lang.startsWith("hi")) {
            chain = new Locale[]{ new Locale("hi", "IN"), Locale.US };
        } else {
            chain = new Locale[]{ Locale.US, new Locale("en", "IN") };
        }

        Locale chosen = null;
        for (Locale loc : chain) {
            int result = tts.isLanguageAvailable(loc);
            if (result == TextToSpeech.LANG_AVAILABLE
                    || result == TextToSpeech.LANG_COUNTRY_AVAILABLE
                    || result == TextToSpeech.LANG_COUNTRY_VAR_AVAILABLE) {
                chosen = loc;
                break;
            }
        }
        if (chosen == null) chosen = Locale.getDefault();
        tts.setLanguage(chosen);

        final String utteranceId = "sanju_" + System.currentTimeMillis();
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String utteranceId) {}
            @Override
            public void onDone(String utteranceId) {
                JSObject ret = new JSObject();
                ret.put("done", true);
                call.resolve(ret);
            }
            @Override
            public void onError(String utteranceId) {
                call.reject("TTS playback error");
            }
        });

        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, utteranceId);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (tts != null) tts.stop();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
    }
}
