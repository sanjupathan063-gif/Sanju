package com.sanju.voiceassistant.plugins;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.util.ArrayList;
import java.util.Locale;

@CapacitorPlugin(
    name = "VoiceInput",
    permissions = {
        @Permission(strings = {Manifest.permission.RECORD_AUDIO}, alias = "recordAudio")
    }
)
public class VoiceInputPlugin extends Plugin {

    private SpeechRecognizer speechRecognizer;
    private Intent recognizerIntent;

    @Override
    public void load() {
        getActivity().runOnUiThread(() -> {
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            recognizerIntent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            recognizerIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            recognizerIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "bn-BD");
            recognizerIntent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);

            speechRecognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) {}
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float rmsdB) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() {}
                @Override public void onError(int error) {
                    JSObject ret = new JSObject();
                    ret.put("error", "Code: " + error);
                    notifyListeners("onError", ret);
                }

                @Override
                public void onResults(Bundle results) {
                    ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (matches != null && !matches.isEmpty()) {
                        JSObject ret = new JSObject();
                        ret.put("transcript", matches.get(0));
                        ret.put("isFinal", true);
                        notifyListeners("onVoiceResult", ret);
                    }
                }

                @Override
                public void onPartialResults(Bundle partialResults) {
                    ArrayList<String> matches = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (matches != null && !matches.isEmpty()) {
                        JSObject ret = new JSObject();
                        ret.put("transcript", matches.get(0));
                        ret.put("isFinal", false);
                        notifyListeners("onVoiceResult", ret);
                    }
                }

                @Override public void onEvent(int eventType, Bundle params) {}
            });
        });
    }

    @PluginMethod
    public void startListening(PluginCall call) {
        String lang = call.getString("language", "bn-BD");
        getActivity().runOnUiThread(() -> {
            try {
                if (recognizerIntent != null && speechRecognizer != null) {
                    recognizerIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
                    speechRecognizer.startListening(recognizerIntent);
                    call.resolve(new JSObject().put("listening", true));
                }
            } catch (Exception e) {
                call.reject("Speech start error: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                if (speechRecognizer != null) {
                    speechRecognizer.stopListening();
                    call.resolve(new JSObject().put("listening", false));
                }
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }
}
