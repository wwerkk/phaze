"use strict";

const wavesAudio = require('waves-audio');
const wavesUI = require('waves-ui');
const wavesLoaders = require('waves-loaders');

let audioContext = wavesAudio.audioContext;
let loader = new wavesLoaders.AudioBufferLoader();

let vocalPath = './sticky-vocals.wav';
let instrPath = './sticky-instr.wav';
let rirPath = './rir.wav';

let BPM = 135;

var speedFactor = 1.0;
var pitchFactor = 1.0;
var pitchSemitones = 0;
var vocalGain = 1.0;
var instrGain = 1.0;

var warpBypassed = false;
var fxBypassed = false;

var delayTime = 1/4;
var delayFeedback = 0.4;
var delayCutoff = 1000;
var delayGain = 0.0;

var reverbBuffer = null;
var reverbGain = 0.0;

var flangerDelayTime = 0.005;
var flangerDepth = 0.0025;
var flangerRate = 0.6;
var flangerFeedback = 0.7;
var flangerCutoff = 1000;
var flangerGain = 0.0;

async function init() {
    if (audioContext.audioWorklet === undefined) {
        handleNoWorklet();
        return;
    }
    const vocalBuffer = await loader.load(vocalPath);
    const instrBuffer = await loader.load(instrPath);
    let [
        vocalPlayerEngine,
        vocalPhaseVocoderNode,
        vocalGainNode
    ] = await setupEngine(vocalBuffer);
    let vocalPlayControl = new wavesAudio.PlayControl(vocalPlayerEngine);
    vocalPlayControl.setLoopBoundaries(0, vocalBuffer.duration);
    vocalPlayControl.loop = true;

    let [
        instrPlayerEngine,
        instrPhaseVocoderNode,
        instrGainNode
    ] = await setupEngine(instrBuffer, 0.0);
    let instrPlayControl = new wavesAudio.PlayControl(instrPlayerEngine);
    instrPlayControl.setLoopBoundaries(0, instrBuffer.duration);
    instrPlayControl.loop = true;
    console.log("Play Control:", instrPlayControl);


    let { delayNode, delayGainNode } = setupDelay(audioContext);
    reverbBuffer = await loader.load(rirPath);
    let { reverbNode, reverbGainNode } = setupReverb(audioContext, reverbBuffer);
    let { flangerDelayNode, flangerGainNode } = setupFlanger(audioContext);

    vocalGainNode.connect(audioContext.destination);
    instrGainNode.connect(audioContext.destination);

    vocalGainNode.connect(delayNode);
    delayGainNode.connect(audioContext.destination);
    vocalGainNode.connect(reverbNode);
    reverbGainNode.connect(audioContext.destination);
    vocalGainNode.connect(flangerDelayNode);
    flangerGainNode.connect(audioContext.destination);

    setupInstrBypassButton(instrGainNode);
    setupWarpBypassButton(
        vocalPlayControl, vocalPhaseVocoderNode,
        instrPlayControl, instrPhaseVocoderNode, delayNode);
    setupFXBypassButton(delayGainNode, reverbGainNode, flangerGainNode);

    setupPlayPauseButton(vocalPlayControl, instrPlayControl);
    setupSpeedSlider(
        vocalPlayControl, vocalPhaseVocoderNode,
        instrPlayControl, instrPhaseVocoderNode, delayNode);
    setupPitchSlider(vocalPhaseVocoderNode, instrPhaseVocoderNode, delayNode);
    setupVocalSlider(vocalGainNode);
    setupDelaySlider(delayGainNode);
    setupReverbSlider(reverbGainNode);
    setupFlangerSlider(flangerGainNode);
    setupTimeline(vocalBuffer, vocalPlayControl);
    document.getElementById('dl-params').addEventListener('click', downloadParams);
}

function handleNoWorklet() {
    let $noWorklet = document.querySelector("#no-worklet");
    $noWorklet.style.display = 'block';
    let $timeline = document.querySelector(".timeline");
    $timeline.style.display = 'none';
    let $controls = document.querySelector(".controls");
    $controls.style.display = 'none';
}

function setupDelay(audioContext) {
    const delayNode = new DelayNode(audioContext, { delayTime: (60 / (BPM * speedFactor)) * 4 * delayTime });
    const delayFeedbackNode = new GainNode(audioContext, { gain: delayFeedback });
    const delayFilterNode = new BiquadFilterNode(audioContext, { type: 'lowpass', frequency: delayCutoff });
    const delayGainNode = new GainNode(audioContext, { gain: delayGain });

    delayNode.connect(delayFilterNode);
    delayFilterNode.connect(delayFeedbackNode);
    delayFeedbackNode.connect(delayNode); // Feedback loop
    delayNode.connect(delayGainNode);

    return { delayNode, delayGainNode };
}

function setupReverb(audioContext, reverbBuffer) {
    const reverbNode = new ConvolverNode(audioContext, { buffer: reverbBuffer });
    const reverbGainNode = new GainNode(audioContext, { gain: reverbGain });

    reverbNode.connect(reverbGainNode);

    return { reverbNode, reverbGainNode };
}

function setupFlanger(audioContext) {
    const flangerDelayNode = new DelayNode(audioContext, { delayTime: flangerDelayTime });
    const flangerFeedbackNode = new GainNode(audioContext, { gain: flangerFeedback });
    const flangerFilterNode = new BiquadFilterNode(audioContext, { type: 'lowpass', frequency: flangerCutoff });
    const flangerDepthNode = new GainNode(audioContext, { gain: flangerDepth });
    const flangerOscillatorNode = new OscillatorNode(audioContext, { type: 'sine', frequency: flangerRate });
    const flangerGainNode = new GainNode(audioContext, { gain: flangerGain });

    flangerOscillatorNode.connect(flangerDepthNode);
    flangerDepthNode.connect(flangerDelayNode.delayTime);
    flangerDelayNode.connect(flangerFeedbackNode);
    flangerFeedbackNode.connect(flangerFilterNode);
    flangerFilterNode.connect(flangerDelayNode);
    flangerDelayNode.connect(flangerGainNode);
    flangerOscillatorNode.start();

    return { flangerDelayNode, flangerGainNode};
}

async function setupEngine(buffer, gain = 1.0) {
    let playerEngine = new wavesAudio.PlayerEngine(buffer);
    playerEngine.buffer = buffer;
    playerEngine.cyclic = true;

    await audioContext.audioWorklet.addModule('phase-vocoder.js');
    let phaseVocoderNode = new AudioWorkletNode(audioContext, 'phase-vocoder-processor');
    let gainNode = new GainNode(audioContext, { gain: gain});
    playerEngine.connect(phaseVocoderNode);
    phaseVocoderNode.connect(gainNode);

    return [
        playerEngine,
        phaseVocoderNode,
        gainNode,
    ];
}

function setupPlayPauseButton(vocalPlayControl, instrPlayControl) {
    let $playButton = document.querySelector('#play-pause');
    let $playIcon = $playButton.querySelector('.play');
    let $pauseIcon = $playButton.querySelector('.pause');
    $playButton.addEventListener('click', function() {
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }

        if (this.dataset.playing === 'false') {
            console.log(vocalPlayControl);
            console.log(instrPlayControl);
            vocalPlayControl.start();
            instrPlayControl.start();
            this.dataset.playing = 'true';
            $playIcon.style.display = 'none';
            $pauseIcon.style.display = 'inline';
        } else if (this.dataset.playing === 'true') {
            vocalPlayControl.pause();
            instrPlayControl.pause();
            this.dataset.playing = 'false';
            $pauseIcon.style.display = 'none';
            $playIcon.style.display = 'inline';
        }
    }, false);
}

function setupInstrBypassButton(instrGainNode) {
    let instrBypassButton = document.getElementById('instr-bypass');
    instrGainNode.gain.value = instrGain;
    instrBypassButton.addEventListener('click', function() {
        instrGain = instrGain === 0.0 ? 1.0 : 0.0;
        instrGainNode.gain.value = instrGain;
        instrBypassButton.textContent = instrGain === 0.0 ? "Enable Instr" : "Bypass Instr";
    }
    );
}

function setupSpeedSlider(vocalPlayControl, vocalPhaseVocoderNode, instrPlayControl, instrPhaseVocoderNode, delayNode) {
    let vocalPitchFactorParam = vocalPhaseVocoderNode.parameters.get('pitchFactor');
    let instrPitchFactorParam = instrPhaseVocoderNode.parameters.get('pitchFactor');
    let $speedSlider = document.querySelector('#speed');
    let $valueLabel = document.querySelector('#speed-value');
    $speedSlider.addEventListener('input', function() {
        speedFactor = parseFloat(this.value);
        vocalPlayControl.speed = warpBypassed ? 1.0 : speedFactor;
        instrPlayControl.speed = warpBypassed ? 1.0 : speedFactor;
        delayNode.delayTime.value = (60 / (BPM * (warpBypassed ? 1 : speedFactor))) * 4 * delayTime;
        vocalPitchFactorParam.value = warpBypassed ? 1.0 : (pitchFactor / speedFactor);
        instrPitchFactorParam.value = warpBypassed ? 1.0 : (pitchFactor * 1 / speedFactor);
        // instrPitchFactorParam.value = warpBypassed ? 1.0 : (1 / speedFactor); // alternatively for instr without pitchshift
        $valueLabel.innerHTML = speedFactor.toFixed(2);
    }, false);
}

function setupPitchSlider(vocalPhaseVocoderNode, instrPhaseVocoderNode) {
    let vocalPitchFactorParam = vocalPhaseVocoderNode.parameters.get('pitchFactor');
    let instrPitchFactorParam = instrPhaseVocoderNode.parameters.get('pitchFactor');
    let $pitchSlider = document.querySelector('#pitch');
    let $valueLabel = document.querySelector('#pitch-value');
    $pitchSlider.addEventListener('input', function() {
        pitchSemitones = parseFloat(this.value);
        pitchFactor = Math.pow(2, pitchSemitones / 12);
        vocalPitchFactorParam.value = warpBypassed ? 1.0 : (pitchFactor / speedFactor);
        instrPitchFactorParam.value = warpBypassed ? 1.0 : (pitchFactor * 1 / speedFactor);
        // instrPitchFactorParam.value = warpBypassed ? 1.0 : (1 / speedFactor); // alternatively for instr without pitchshift
        $valueLabel.innerHTML = pitchSemitones.toFixed(0);
    }, false);
}

function setupVocalSlider(vocalGainNode) {
    let $vocalSlider = document.querySelector('#vocal');
    let $valueLabel = document.querySelector('#vocal-value');
    $vocalSlider.addEventListener('input', function() {
        vocalGain = parseFloat(this.value) ** 0.9;
        vocalGainNode.gain.value = vocalGain;
        $valueLabel.innerHTML = vocalGain.toFixed(2);
    }, false);
}

function setupDelaySlider(delayGainNode) {
    let $delaySlider = document.querySelector('#delay');
    let $valueLabel = document.querySelector('#delay-value');

    $delaySlider.addEventListener('input', function() {
        delayGain = parseFloat(this.value) ** 0.9;
        delayGainNode.gain.value = fxBypassed ? 0 : delayGain;
        $valueLabel.innerHTML = delayGain.toFixed(2);
    }, false);
}

function setupReverbSlider(reverbGainNode) {
    let $reverbSlider = document.querySelector('#reverb');
    let $valueLabel = document.querySelector('#reverb-value');

    $reverbSlider.addEventListener('input', function() {
        reverbGain = parseFloat(this.value) ** 0.9;
        reverbGainNode.gain.value = fxBypassed ? 0 : reverbGain;
        console.log(reverbGainNode.gain.value);
        $valueLabel.innerHTML = reverbGain.toFixed(2);
    }, false);
}

function setupFlangerSlider(flangerGainNode) {
    let $flangerSlider = document.querySelector('#flanger');
    let $valueLabel = document.querySelector('#flanger-value');

    $flangerSlider.addEventListener('input', function() {
        flangerGain = parseFloat(this.value) ** 0.9;
        flangerGainNode.gain.value = fxBypassed ? 0 : flangerGain;
        $valueLabel.innerHTML = flangerGain.toFixed(2);
    }, false);
}

function setupWarpBypassButton(vocalPlayControl, vocalPhaseVocoderNode, instrPlayControl, instrPhaseVocoderNode, delayNode) {
    let warpBypassButton = document.getElementById('warp-bypass');
    warpBypassed = false;

    warpBypassButton.addEventListener('click', function() {
        warpBypassed = !warpBypassed;

        if (warpBypassed) {
            // Change pitchFactor and speed to 1.0
            vocalPhaseVocoderNode.parameters.get('pitchFactor').value = 1.0;
            instrPhaseVocoderNode.parameters.get('pitchFactor').value = 1.0;
            vocalPlayControl.speed = 1.0;
            instrPlayControl.speed = 1.0;
            delayNode.delayTime.value = (60 / BPM) * 4 * delayTime;
        } else {
            // Change pitchFactor and speed to slider values
            vocalPhaseVocoderNode.parameters.get('pitchFactor').value = pitchFactor * 1 / speedFactor;
            instrPhaseVocoderNode.parameters.get('pitchFactor').value = pitchFactor * 1 / speedFactor;
            vocalPlayControl.speed  = speedFactor;
            instrPlayControl.speed = speedFactor;
            delayNode.delayTime.value = (60 / (BPM * speedFactor)) * 4 * delayTime;
        }
        
        warpBypassButton.textContent = warpBypassed ? "Enable Warp" : "Bypass Warp";
    });
}

function setupFXBypassButton(delayGainNode, reverbGainNode, flangerGainNode) {
    let fxBypassButton = document.getElementById('fx-bypass');
    fxBypassed = false;

    fxBypassButton.addEventListener('click', function() {
        fxBypassed = !fxBypassed;

        if (fxBypassed) {
            // Set effect gains to 0 to bypass effects
            delayGainNode.gain.value = 0;
            reverbGainNode.gain.value = 0;
            flangerGainNode.gain.value = 0;
        } else {
            // Restore effect gains to slider values
            delayGainNode.gain.value = delayGain;
            reverbGainNode.gain.value = reverbGain;
            flangerGainNode.gain.value = flangerGain;
        }

        fxBypassButton.textContent = fxBypassed ? "Enable FX" : "Bypass FX";
    });
}



function setupTimeline(buffer, playControl) {
    let $timeline = document.querySelector('#timeline');

    const width = $timeline.getBoundingClientRect().width;
    const height = 200;
    const duration = buffer.duration;
    const pixelsPerSecond = width / duration;

    let timeline = new wavesUI.core.Timeline(pixelsPerSecond, width);
    timeline.createTrack($timeline, height, 'main');
    let waveformLayer = new wavesUI.helpers.WaveformLayer(buffer, {
        height: height
    });

    // cursor
    let cursorData = { position: 0 };
    let cursorLayer = new wavesUI.core.Layer('entity', cursorData, {
      height: height
    });

    let timeContext = new wavesUI.core.LayerTimeContext(timeline.timeContext);
    cursorLayer.setTimeContext(timeContext);
    cursorLayer.configureShape(wavesUI.shapes.Cursor, {
        x: (data) => { return data.position; }
    }, {
        color: 'red'
    });

    timeline.addLayer(waveformLayer, 'main');
    timeline.addLayer(cursorLayer, 'main');

    timeline.tracks.render();
    timeline.tracks.update();

    // cursor animation loop
    (function loop() {
        cursorData.position = playControl.currentPosition;
        timeline.tracks.update(cursorLayer);

        requestAnimationFrame(loop);
    }());
}

function downloadParams() {
    const settings = {
        vocalPath,
        instrPath,
        speedFactor,
        pitchSemitones,
        vocalGain,
        instrGain,
        warpBypassed,
        fxBypassed,
        delay: {
            delayTime,
            delayFeedback,
            delayCutoff,
            delayGain,
        },
        reverb: {
            reverbGain,
            rirPath,
        },
        flanger: {
            flangerDelayTime,
            flangerDepth,
            flangerRate,
            flangerFeedback,
            flangerCutoff,
            flangerGain,
        },
    };

    const settingsStr = JSON.stringify(settings, null, 2);
    const blob = new Blob([settingsStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    // Create a link and trigger the download
    const a = document.createElement('a');
    a.href = url;
    a.download = 'FXParams.json';
    document.body.appendChild(a);
    a.click();

    // Clean up
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}


window.addEventListener('load', init);
