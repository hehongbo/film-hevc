import libde265 from "hs265";

export default class FilmHEVC {
    constructor(url, selectorTarget, options = {
        drawFirstFrame: false,
        logOutput: false
    }) {
        this.canvas = document.createElement("canvas");
        this.imageData = [];
        this.logOutput = options.logOutput;
        this.ready = false;
        this.currentFrame = -1;

        let pendingYuvFrames = 0;
        let preparingStatus = 0;

        let xhr = new XMLHttpRequest();
        xhr.open("GET", url, true);
        xhr.responseType = "arraybuffer";

        let drawFirstFrame = () => {
            this.canvas.getContext("2d").putImageData(this.imageData[0], 0, 0);
            this.currentFrame = 0;
        };

        xhr.onload = () => {
            let decoder = new libde265.Decoder();

            decoder.set_image_callback(image => {
                this.log("Got a decoded frame.");
                pendingYuvFrames++;
                if (preparingStatus === 0) {
                    this.footageWidth = image.get_width();
                    this.footageHeight = image.get_height();
                    this.log(`First frame arrived, initialize the canvas with w=${
                        this.footageWidth
                    }, h=${
                        this.footageHeight
                    }.`);
                    this.canvas.width = this.footageWidth;
                    this.canvas.height = this.footageHeight;
                    document.querySelector(selectorTarget).appendChild(this.canvas);
                    preparingStatus++;
                }

                let imageData = document.createElement("canvas")
                    .getContext("2d")
                    .createImageData(this.footageWidth, this.footageHeight);
                image.display(imageData, b => {
                    this.imageData.push(b);
                    pendingYuvFrames--;
                    this.log(`Frame ${this.imageData.length - 1} converted from YUV to RGB ImageData.`);
                    if (this.imageData.length === 1 && options.drawFirstFrame) {
                        this.log("Drawing the first frame we get.");
                        drawFirstFrame();
                    }
                    if (preparingStatus === 2 && pendingYuvFrames === 0) {
                        preparingStatus++;
                        this.log("All frames prepared.")
                        this.ready = true;
                        this.frameCount = this.imageData.length;
                    }
                });
                image.free();
            });

            let data = xhr.response;
            let position = 0;
            let remaining = data.byteLength;

            let runDecode = () => {
                let err;
                if (remaining === 0) {
                    // this.log("End of stream, flushing data.");
                    err = decoder.flush();
                } else {
                    let length = remaining < 4096 ? remaining : 4096;
                    this.log(`Pushing ${length} bytes of data to the decoder. (${position} bytes already sent)`);
                    err = decoder.push_data(new Uint8Array(data, position, length));
                    position += length;
                    remaining -= length;
                }
                if (!libde265.de265_isOK(err)) {
                    this.log(`Got an error from libde265: ${libde265.de265_get_error_text(err)}`, 2);
                    return;
                }

                decoder.decode(err => {
                    switch (err) {
                        case libde265.DE265_ERROR_WAITING_FOR_INPUT_DATA:
                            this.log("libde265 is still waiting for input data.");
                            setTimeout(runDecode, 0);
                            return;
                        default:
                            if (!libde265.de265_isOK(err)) {
                                this.log(`Got an error from libde265: ${libde265.de265_get_error_text(err)}`, 2);
                                return;
                            }
                    }

                    if (remaining > 0) {
                        setTimeout(runDecode, 0);
                    } else if (decoder.has_more()) {
                        this.log("All data pushed but the decoder has more frames to decode.");
                        setTimeout(runDecode, 0);
                    } else {
                        this.log("All frames have been decoded, freeing the decoder.");
                        preparingStatus++;
                        decoder.free();
                    }
                });
            };
            this.log("Start decoding.");
            setTimeout(runDecode, 0);
        };
        xhr.send();
    }

    log(message, level = 0) {
        if (this.logOutput) {
            switch (level) {
                case 1:
                    console.warn("FilmHEVC: " + message);
                    break;
                case 2:
                    console.error("FilmHEVC: " + message);
                    break;
                default:
                    console.log("FilmHEVC: " + message);
            }
        }
    }

    drawFrame(f = 0) {
        if (f !== this.currentFrame) {
            if (this.ready) {
                if (f <= this.frameCount - 1) {
                    this.log(`Drawing frame ${f}.`);
                } else {
                    this.log(`Requested frame is out of range. The footage is ${this.frameCount} frames in total.`, 2);
                    return;
                }
            } else {
                if (f <= this.imageData.length - 1) {
                    this.log(`Frame ${f} is required but the footage is not entirely decoded and prepared. `, 1);
                } else {
                    this.log(`Frame ${f} is required which is not decoded yet.`, 2);
                    return;
                }
            }
            this.canvas.getContext("2d").putImageData(this.imageData[f], 0, 0);
            this.currentFrame = f;
        }
        return f;
    }

    seek(percentage = 0.00) {
        if (this.ready) {
            this.drawFrame(Math.floor((this.frameCount - 1) * percentage));
            return percentage;
        } else {
            this.log("Method seek(p) is not available until the entire footage is completely decoded.", 2);
        }
    }
}
