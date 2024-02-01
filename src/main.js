"use strict";

const wavesAudio = require('waves-audio');
const wavesUI = require('waves-ui');
const wavesLoaders = require('waves-loaders');

let audioContext = wavesAudio.audioContext;
let loader = new wavesLoaders.AudioBufferLoader();

var speedFactor = 1.0;
var pitchFactor = 1.0;
var vocalGain = 1.0;

var delayTime = 0.5;
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
    const buffer = await loader.load('./sticky-vocals.wav');
    let [
        playerEngine,
        phaseVocoderNode,
        vocalGainNode
    ] = await setupEngine(buffer);
    let playControl = new wavesAudio.PlayControl(playerEngine);
    playControl.setLoopBoundaries(0, buffer.duration);
    playControl.loop = true;

    let { delayNode, delayGainNode } = setupDelay(audioContext);
    reverbBuffer = await loader.load('./rir.wav');
    let { reverbNode, reverbGainNode } = setupReverb(audioContext, reverbBuffer);
    let { flangerDelayNode, flangerGainNode } = setupFlanger(audioContext);

    vocalGainNode.connect(audioContext.destination);

    vocalGainNode.connect(delayNode);
    delayGainNode.connect(audioContext.destination); // Also connect feedback to destination
    vocalGainNode.connect(reverbNode);
    reverbGainNode.connect(audioContext.destination);
    vocalGainNode.connect(flangerDelayNode);
    flangerGainNode.connect(audioContext.destination);

    setupPlayPauseButton(playControl);
    setupSpeedSlider(playControl, phaseVocoderNode);
    setupPitchSlider(phaseVocoderNode);
    setupVocalSlider(vocalGainNode);
    setupDelaySlider(delayNode, delayGainNode);
    setupReverbSlider(reverbGainNode);
    setupFlangerSlider(flangerGainNode);
    setupTimeline(buffer, playControl);
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
    const delayNode = new DelayNode(audioContext, { delayTime: delayTime });
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




async function setupEngine(buffer) {
    let playerEngine = new wavesAudio.PlayerEngine(buffer);
    playerEngine.buffer = buffer;
    playerEngine.cyclic = true;

    await audioContext.audioWorklet.addModule('phase-vocoder.js');
    let phaseVocoderNode = new AudioWorkletNode(audioContext, 'phase-vocoder-processor');
    let vocalGainNode = new GainNode(audioContext, { gain: vocalGain });
    playerEngine.connect(phaseVocoderNode);
    phaseVocoderNode.connect(vocalGainNode);

    return [
        playerEngine,
        phaseVocoderNode,
        vocalGainNode,
    ];
}

function setupPlayPauseButton(playControl) {
    let $playButton = document.querySelector('#play-pause');
    let $playIcon = $playButton.querySelector('.play');
    let $pauseIcon = $playButton.querySelector('.pause');
    $playButton.addEventListener('click', function() {
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }

        if (this.dataset.playing === 'false') {
            playControl.start();
            this.dataset.playing = 'true';
            $playIcon.style.display = 'none';
            $pauseIcon.style.display = 'inline';
        } else if (this.dataset.playing === 'true') {
            playControl.pause();
            this.dataset.playing = 'false';
            $pauseIcon.style.display = 'none';
            $playIcon.style.display = 'inline';
        }
    }, false);
}

function setupSpeedSlider(playControl, phaseVocoderNode) {
    let pitchFactorParam = phaseVocoderNode.parameters.get('pitchFactor');
    let $speedSlider = document.querySelector('#speed');
    let $valueLabel = document.querySelector('#speed-value');
    $speedSlider.addEventListener('input', function() {
        speedFactor = parseFloat(this.value);
        playControl.speed = speedFactor;
        pitchFactorParam.value = pitchFactor * 1 / speedFactor;
        $valueLabel.innerHTML = speedFactor.toFixed(2);
    }, false);
}

function setupPitchSlider(phaseVocoderNode) {
    let pitchFactorParam = phaseVocoderNode.parameters.get('pitchFactor');
    let $pitchSlider = document.querySelector('#pitch');
    let $valueLabel = document.querySelector('#pitch-value');
    $pitchSlider.addEventListener('input', function() {
        pitchFactor = parseFloat(this.value);
        pitchFactorParam.value = pitchFactor * 1 / speedFactor;
        $valueLabel.innerHTML = pitchFactor.toFixed(2);
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

function setupDelaySlider(delayNode, delayGainNode) {
  let $delaySlider = document.querySelector('#delay');
  let $valueLabel = document.querySelector('#delay-value');
  
  $delaySlider.addEventListener('input', function() {
      delayGain = parseFloat(this.value) ** 0.9;
      delayGainNode.gain.value = delayGain;
      $valueLabel.innerHTML = delayGain.toFixed(2);
  }, false);
}

function setupReverbSlider(reverbGainNode) {
  let $reverbSlider = document.querySelector('#reverb');
  let $valueLabel = document.querySelector('#reverb-value');
  
  $reverbSlider.addEventListener('input', function() {
      reverbGain = parseFloat(this.value) ** 0.9;
      reverbGainNode.gain.value = reverbGain;
      $valueLabel.innerHTML = reverbGain.toFixed(2);
  }, false);
}

function setupFlangerSlider(flangerGainNode) {
    let $flangerSlider = document.querySelector('#flanger');
    let $valueLabel = document.querySelector('#flanger-value');

    $flangerSlider.addEventListener('input', function() {
        flangerGain = parseFloat(this.value) ** 0.9;
        flangerGainNode.gain.value = flangerGain;
        $valueLabel.innerHTML = flangerGain.toFixed(2);
    }, false);
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

window.addEventListener('load', init);
