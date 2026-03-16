/**
 * Notification Sound Handler
 * Handles playing custom sound for push notifications on all devices (iOS, Android, desktop)
 * 
 * Problem: Service workers cannot reliably play audio on mobile browsers
 * Solution: Listen for messages from service worker and play sound from main thread
 */

// Audio element for playing notification sounds
let notificationAudio = null;

/**
 * Initialize the notification sound system
 * Call this once when the app loads
 */
function initNotificationSound() {
    // Create an audio element that will be reused for all notifications
    notificationAudio = new Audio();
    notificationAudio.preload = 'auto';
    notificationAudio.volume = 1.0;
    
    // Set the sound file
    notificationAudio.src = '/sounds/Car Horn Beeps.mp3';
    
    console.log('✅ Notification sound initialized:', notificationAudio.src);
    
    // Listen for messages from service worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'PLAY_NOTIFICATION_SOUND') {
                console.log('🔊 Service worker requesting sound play');
                playNotificationSound(event.data.sound);
            }
        });
    }
}

/**
 * Play the notification sound
 * Works around browser autoplay restrictions
 */
async function playNotificationSound(soundFile) {
    try {
        // If a different sound file is specified, use it
        if (soundFile && soundFile !== notificationAudio.src) {
            notificationAudio.src = soundFile;
        }
        
        // Reset playback to start
        notificationAudio.currentTime = 0;
        
        // Try to play the sound
        const playPromise = notificationAudio.play();
        
        if (playPromise !== undefined) {
            playPromise
                .then(() => {
                    console.log('✅ Notification sound playing');
                })
                .catch((error) => {
                    console.warn('⚠️  Cannot autoplay sound (browser restriction):', error.name);
                    // Fallback: use Web Audio API to generate a tone
                    playFallbackAlert();
                });
        }
    } catch (err) {
        console.error('❌ Error playing notification sound:', err);
        // Fallback to Web Audio beep
        playFallbackAlert();
    }
}

/**
 * Fallback: Generate a beep sound using Web Audio API
 * This works even when autoplay is restricted
 */
function playFallbackAlert() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        
        // Play a series of beeps
        const beeps = [
            { freq: 1000, duration: 150, delay: 0 },
            { freq: 800, duration: 150, delay: 200 },
            { freq: 1000, duration: 150, delay: 400 }
        ];
        
        beeps.forEach(({ freq, duration, delay }) => {
            setTimeout(() => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                
                osc.connect(gain);
                gain.connect(ctx.destination);
                
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, ctx.currentTime);
                gain.gain.setValueAtTime(0.3, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration / 1000);
                
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + duration / 1000);
            }, delay);
        });
        
        console.log('✅ Fallback alert sound playing');
    } catch (err) {
        console.warn('⚠️  Web Audio API not available:', err);
    }
}

/**
 * Enable sound on user interaction (required for iOS)
 * Call this when user first interacts with the app
 */
function enableNotificationSoundOnInteraction() {
    document.addEventListener('click', () => {
        if (notificationAudio) {
            // Play silent audio to unlock autoplay
            notificationAudio.volume = 0;
            notificationAudio.play().catch(() => {
                // Silently fail - we're just priming the audio context
            });
            notificationAudio.volume = 1.0;
        }
    }, { once: true });
    
    console.log('🔓 Sound enabled on first user interaction (iOS compatibility)');
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initNotificationSound();
    enableNotificationSoundOnInteraction();
});

// Also initialize if page is already loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initNotificationSound();
        enableNotificationSoundOnInteraction();
    });
} else {
    initNotificationSound();
    enableNotificationSoundOnInteraction();
}

console.log('🔊 Notification sound handler loaded');
