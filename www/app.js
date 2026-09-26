// Sanju App Main JS

// 1. Remove markdown formatting like **, #, _
function cleanTextForSpeech(text) {
    return text.replace(/[*#_]/g, '');
}

// 2. Female voice selection
function speak(text) {
    let cleanText = cleanTextForSpeech(text);
    let utterance = new SpeechSynthesisUtterance(cleanText);
    let voices = window.speechSynthesis.getVoices();
    
    // Filter female voices
    let femaleVoice = voices.find(v => 
        v.name.toLowerCase().includes('female') || 
        v.name.toLowerCase().includes('zira') || 
        v.name.toLowerCase().includes('google uk english female')
    );
    
    if (femaleVoice) {
        utterance.voice = femaleVoice;
    }
    
    window.speechSynthesis.speak(utterance);
}

// 3. Wake word listener (Connects to native foreground service)
function startWakeWordListener() {
    console.log("Listening for 'Sanju' wake word...");
    if(window.VoiceInputPlugin) {
        window.VoiceInputPlugin.startBackgroundListener({ wakeWord: 'sanju' });
    }
}

document.addEventListener('deviceready', () => {
    startWakeWordListener();
});
