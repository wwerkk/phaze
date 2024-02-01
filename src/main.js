"use strict";

const wavesAudio = require('waves-audio');
const wavesUI = require('waves-ui');
const wavesLoaders = require('waves-loaders');

let audioContext = wavesAudio.audioContext;
let loader = new wavesLoaders.AudioBufferLoader();

var speedFactor = 1.0;
var pitchFactor = 1.0;
var delayTime = 0.5;
var delayGain = 0.5;

async function init() {
    if (audioContext.audioWorklet === undefined) {
        handleNoWorklet();
        return;
    }
    const buffer = await loader.load('./sticky-vocals.wav');
    let [playerEngine, phaseVocoderNode, delayNode, delayGainNode, delayFeedbackNode] = await setupEngine(buffer);
    let playControl = new wavesAudio.PlayControl(playerEngine);
    playControl.setLoopBoundaries(0, buffer.duration);
    playControl.loop = true;

    setupPlayPauseButton(playControl);
    setupSpeedSlider(playControl, phaseVocoderNode);
    setupPitchSlider(phaseVocoderNode);
    setupDelaySlider(delayNode, delayGainNode, delayFeedbackNode);
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

async function setupEngine(buffer) {
    let playerEngine = new wavesAudio.PlayerEngine(buffer);
    playerEngine.buffer = buffer;
    playerEngine.cyclic = true;

    await audioContext.audioWorklet.addModule('phase-vocoder.js');
    let phaseVocoderNode = new AudioWorkletNode(audioContext, 'phase-vocoder-processor');
    playerEngine.connect(phaseVocoderNode);
    phaseVocoderNode.connect(audioContext.destination);

    // Create delay node with feedback loop
    let delayNode = new DelayNode(audioContext, { delayTime: 0.5 });
    let delayGainNode = new GainNode(audioContext, { gain: 0 });
    let delayFeedbackNode = new GainNode(audioContext, { gain: 0.5 });
    let lowpassFilterNode = new BiquadFilterNode(audioContext, { type: 'lowpass', frequency: 1000 });

    // Connect nodes for delay with feedback and lowpass filter
    phaseVocoderNode.connect(delayNode);
    delayNode.connect(lowpassFilterNode);
    lowpassFilterNode.connect(delayFeedbackNode);
    delayFeedbackNode.connect(delayNode); // Feedback loop
    delayFeedbackNode.connect(audioContext.destination); // Also connect feedback to destination

    return [playerEngine, phaseVocoderNode, delayNode, delayGainNode, delayFeedbackNode, lowpassFilterNode];
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

function setupDelaySlider(delayNode, delayGainNode, delayFeedbackNode) {
  let $delaySlider = document.querySelector('#delay');
  let $valueLabel = document.querySelector('#delay-value');
  
  $delaySlider.addEventListener('input', function() {
      let delayGain = parseFloat(this.value) ** 0.9;
      delayGainNode.gain.value = delayGain;
      delayFeedbackNode.gain.value = delayGain * 0.5;
      $valueLabel.innerHTML = delayGain.toFixed(2);
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
