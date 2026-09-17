/* global AudioWorkletProcessor, registerProcessor */
class MonoCaptureProcessor extends AudioWorkletProcessor {
  active = true

  constructor() {
    super()
    this.port.onmessage = ({ data }) => {
      if (data === 'stop') {
        this.active = false
        this.port.postMessage('stopped')
      }
    }
  }

  process(inputs) {
    const channels = inputs[0]
    if (this.active && channels?.[0]?.length) {
      const mono = new Float32Array(channels[0].length)
      for (const channel of channels) {
        for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length
      }
      this.port.postMessage(mono, [mono.buffer])
    }
    return this.active
  }
}

registerProcessor('linguaweave-mono-capture', MonoCaptureProcessor)
