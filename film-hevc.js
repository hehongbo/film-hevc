import libde265 from "hs265";

export default class FilmHEVC {
    constructor(url, selectorTarget, onCreate = {
        runDecode: false,
        drawFirstFrame: false
    }, verbose = false) {
        this.url = url;
        this.canvas = document.createElement("canvas");
        this.images = [];
        this.status = 0;
        this.ready = false;
        this.currentFrame = -1;
        this.logOutput = verbose;

        document.querySelector(selectorTarget).appendChild(this.canvas);

        if (onCreate.runDecode) {
            this.runDecode(onCreate.drawFirstFrame).then();
        }
    }

    runDecode(drawFirstFrame = false) {
        return new Promise((resolve, reject) => {
            if (this.status === 0) {
                if (typeof createImageBitmap !== "undefined") {
                    this.status++;

                    let pendingYuvFrames = 0;

                    let xhr = new XMLHttpRequest();
                    xhr.open("GET", this.url, true);
                    xhr.responseType = "arraybuffer";

                    xhr.onload = () => {
                        let decoder = new libde265.Decoder();

                        decoder.set_image_callback(image => {
                            this.log("Got a decoded frame.");
                            pendingYuvFrames++;
                            if (this.status === 1) {
                                this.footageWidth = image.get_width();
                                this.footageHeight = image.get_height();
                                this.log(`First frame arrived, initialize the canvas with w=${
                                    this.footageWidth
                                }, h=${
                                    this.footageHeight
                                }.`);
                                this.canvas.width = this.footageWidth;
                                this.canvas.height = this.footageHeight;
                                this.status++;
                            }

                            let imageData = document.createElement("canvas")
                                .getContext("2d")
                                .createImageData(this.footageWidth, this.footageHeight);
                            image.display(imageData, convertedRGBImageData => {
                                createImageBitmap(convertedRGBImageData).then(convertedImageBitmap => {
                                    this.images.push(convertedImageBitmap);
                                    pendingYuvFrames--;
                                    this.log(`Frame ${this.images.length - 1} converted from YUV to ImageBitmap.`);
                                    if (this.images.length === 1 && drawFirstFrame) {
                                        this.log("Drawing the first frame we get.");
                                        this.canvas.getContext("2d").drawImage(this.images[0], 0, 0);
                                        this.currentFrame = 0;
                                    }
                                    if (this.status === 3 && pendingYuvFrames === 0) {
                                        this.status++;
                                        this.log("All decoded YUV frames have been converted.");
                                        this.frameCount = this.images.length;
                                        this.ready = true;
                                        resolve();
                                    }
                                });
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
                                this.log(
                                    `Pushing ${length} bytes of data to the decoder. (${position} bytes already sent)`
                                );
                                err = decoder.push_data(new Uint8Array(data, position, length));
                                position += length;
                                remaining -= length;
                            }
                            if (!libde265.de265_isOK(err)) {
                                this.log(`Got an error from libde265: ${libde265.de265_get_error_text(err)}`, 2);
                                reject(new Error("LIBDE265_ERROR"));
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
                                            this.log(
                                                `Got an error from libde265: ${libde265.de265_get_error_text(err)}`, 2
                                            );
                                            reject(new Error("LIBDE265_ERROR"));
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
                                    this.status++;
                                    decoder.free();
                                }
                            });
                        };
                        this.log("Start decoding.");
                        setTimeout(runDecode, 0);
                    };
                    xhr.send();
                } else {
                    this.log("Method createImageBitmap() is not supported on your device. The decoder won't start. ", 2);
                    reject(new Error("LACK_OF_SUPPORT"));
                }

            } else {
                this.log("The decoder has already been fired.", 2);
                reject(new Error("ALREADY_DECODED"));
            }
        });
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
                if (f <= this.images.length - 1) {
                    this.log(`Frame ${f} is required but the footage is not entirely decoded and prepared. `, 1);
                } else {
                    this.log(`Frame ${f} is required which is not ready yet.`, 2);
                    return;
                }
            }
            this.canvas.getContext("2d").drawImage(this.images[f], 0, 0);
            this.currentFrame = f;
        }
        return f;
    }

    seek(percentage = 0.00) {
        if (this.ready) {
            this.drawFrame(Math.floor((this.frameCount - 1) * percentage));
            return percentage;
        } else {
            this.log("Method seek() is not available until the entire footage is completely decoded.", 2);
        }
    }
}
