const net = require("net");
const { statusCodes, errorFromStatusCode } = require("./status-codes.js");
const { calculateBcc, addBcc } = require("./bcc.js");
const {
    formatNumberAsString,
    parseNumberFromAscii,
    parseBooleanFromAscii,

    tryParseStatusResponse,
    tryParseStatusResponseWithBcc,

    tryParseDetectCarriersExtendedAckResponse,
    tryParseDetectCarriersExtendedPacket,
    parseDataBlock
} = require("./format-parse.js");
const { STX, ACK, NAK } = require("./constants.js");
const { multiPartRequest } = require("./request.js");

const connect = ({ ipAddress, port, connectTimeoutMs = 4000, onConnect, onError }) => {

    console.log(`connecting to ${ipAddress}:${port}`);

    let connected = false;
    let closed = false;

    let queuedSlotRequests = [];
    let currentSlot = undefined;

    let emittedError = undefined;

    const connectTimeoutHandle = setTimeout(() => {
        failAndTeardown({ error: Error(`connect timeout after ${connectTimeoutMs}ms`) });
    }, connectTimeoutMs);

    const tcpConn = net.connect({
        host: ipAddress,
        port
    }, () => {
        connected = true;
        clearTimeout(connectTimeoutHandle);

        // make sure exceptions will be uncaught
        // and don't interfere with the connection
        setTimeout(() => {
            if (closed || emittedError !== undefined) {
                return;
            }
            
            onConnect();
        }, 0);

        maybeRunNextSlot();
        checkConnection();
    });

    tcpConn.on("error", (err) => {
        failAndTeardown({ error: err });
    });

    tcpConn.on("end", () => {
        failAndTeardown({ error: Error("connection closed by remote end") });
    });

    const requestHandler = multiPartRequest({
        connection: tcpConn,
        onError: (error) => {

            if (closed) {
                return;
            }

            failAndTeardown({ error: Error(`request failed making connection invalid`, { cause: error }) });
        }
    });

    const rejectPendingRequests = ({ error }) => {
        queuedSlotRequests.forEach((slotRequest) => {
            slotRequest.reject(error);
        });
        queuedSlotRequests = [];

        requestHandler.maybeFail({ error });
    };

    const teardown = () => {
        if (connectTimeoutHandle !== undefined) {
            clearTimeout(connectTimeoutHandle);
            connCheckTimeoutHandle = undefined;
        }

        if (connCheckTimeoutHandle !== undefined) {
            clearTimeout(connCheckTimeoutHandle);
            connCheckTimeoutHandle = undefined;
        }

        if (queuedSlotRequests.length > 0) {
            throw Error("must not have queued slot requests on teardown");
        }

        // if (currentSlot !== undefined) {
        //     throw Error("must not have current slot on teardown");
        // }

        tcpConn.destroy();
        connected = false;
    };

    const failAndTeardown = ({ error }) => {
        if (closed) {
            throw Error("connection already closed", { cause: error });
        }

        if (emittedError !== undefined) {
            throw Error("connection already failed", { cause: error });
        }

        rejectPendingRequests({ error });
        teardown();

        emittedError = error;
        onError(error);
    };

    const maybeRunNextSlot = () => {
        if (closed) {
            return;
        }

        if (!connected) {
            return;
        }

        if (queuedSlotRequests.length === 0) {
            return;
        }

        if (currentSlot !== undefined) {
            return;
        }

        const nextSlot = queuedSlotRequests[0];
        queuedSlotRequests = queuedSlotRequests.slice(1);

        currentSlot = {};

        Promise.resolve().then(() => {
            const slotPromise = nextSlot.slotFn();

            if (slotPromise === undefined || slotPromise.then === undefined) {
                throw Error("slot must return a promise");
            }

            return slotPromise;
        }).then((res) => {
            currentSlot = undefined;
            nextSlot.resolve(res);
            maybeRunNextSlot();
        }, (err) => {
            nextSlot.reject(err);
        });
    };

    const requestSlot = (fn) => {
        return new Promise((resolve, reject) => {
            queuedSlotRequests = [
                ...queuedSlotRequests,
                {
                    slotFn: fn,
                    resolve,
                    reject
                }
            ];

            maybeRunNextSlot();
        });
    };

    const readDeviceParameters = ({ antennaNumber, parameterNumber }) => {
        const enc = new TextEncoder();

        if (antennaNumber < 1 || antennaNumber > 4) {
            throw new Error(`antennaNumber must be between 1 and 4`);
        }

        const antennaNumberAsString = formatNumberAsString({ number: antennaNumber, radix: 10, length: 1 });
        const parameterNumberAsString = formatNumberAsString({ number: parameterNumber, radix: 16, length: 4 });

        const messageAsUint8Array = addBcc({
            messageAsUint8Array: enc.encode(`G${antennaNumberAsString}${parameterNumberAsString}`)
        });

        return requestSlot(() => {

            return requestHandler.talk({
                requestAsUint8Array: messageAsUint8Array,
                tryParse: ({ buffer }) => {

                    if (buffer.length < 7) {
                        return undefined;
                    }

                    const dec = new TextDecoder();

                    if (buffer[0] !== 0x06) {
                        throw Error(`expected 0x06 (<ACK>) as first byte of response`);
                    }

                    if (buffer[1] !== 0x30) {
                        throw Error(`expected 0x30 (0) as second byte of response`);
                    }

                    const antennaNumberAsString = dec.decode(buffer.subarray(2, 3));
                    const antennaNumber = parseInt(antennaNumberAsString, 10);

                    if (isNaN(antennaNumber)) {
                        throw Error(`expected antennaNumber to be a number`);
                    }

                    const numberOfBytesAsString = dec.decode(buffer.subarray(3, 5));
                    const numberOfBytes = parseInt(numberOfBytesAsString, 10);

                    if (isNaN(numberOfBytes)) {
                        throw Error(`expected numberOfBytes to be a number`);
                    }

                    const parameterNumberAsString = dec.decode(buffer.subarray(5, 9));
                    const parameterNumber = parseInt(parameterNumberAsString, 16);

                    if (isNaN(parameterNumber)) {
                        throw Error(`expected parameterNumber to be a number`);
                    }

                    const parameterValue = buffer.subarray(9, 9 + numberOfBytes);
                    const bcc = buffer[9 + numberOfBytes];

                    const calculatedBcc = calculateBcc({ messageAsUint8Array: buffer.subarray(0, 9 + numberOfBytes) });
                    if (bcc !== calculatedBcc) {
                        throw Error(`expected bcc to be ${calculatedBcc} but was ${bcc}`);
                    }

                    return {
                        value: parameterValue
                    };
                }
            });
        });
    };

    const requestChangeDeviceParameter = async ({ antennaNumber, parameterNumber, value }) => {
        const enc = new TextEncoder();

        if (antennaNumber < 0 || antennaNumber > 4) {
            throw new Error(`antennaNumber must be either 0 for all or between 1 and 4`);
        }

        const antennaNumberAsString = formatNumberAsString({ number: antennaNumber, radix: 10, length: 1 });
        const numberOfBytesAsString = formatNumberAsString({ number: value.length, radix: 10, length: 2 });
        const parameterNumberAsString = formatNumberAsString({ number: parameterNumber, radix: 16, length: 4 });

        let headerAsString = "E";
        headerAsString += antennaNumberAsString;
        headerAsString += numberOfBytesAsString;
        headerAsString += parameterNumberAsString;

        const messageAsUint8Array = addBcc({
            messageAsUint8Array: new Uint8Array([
                ...enc.encode(`E${antennaNumberAsString}${numberOfBytesAsString}${parameterNumberAsString}`),
                ...value
            ])
        });

        const { statusCode } = await requestSlot(() => {
            return requestHandler.talk({
                requestAsUint8Array: messageAsUint8Array,
                tryParse: tryParseStatusResponseWithBcc,
                timeoutMs: 5000
            });
        });

        return {
            statusCode
        };
    };

    const detectDataCarriersExtended = async ({
        antennaNumber = 0,
        dataType: requestedDataType = "E",
        maxNumberCarriers = 999,
        onlySelected = false,
        timeoutMs = 15000
    }) => {

        if (["E", "T"].indexOf(requestedDataType) < 0) {
            throw new Error(`dataType must be either "E" or "T"`);
        }

        let messageAsString = ",";
        messageAsString += formatNumberAsString({ number: antennaNumber, radix: 10, length: 1 });
        messageAsString += requestedDataType;
        messageAsString += formatNumberAsString({ number: maxNumberCarriers, radix: 10, length: 3 });
        messageAsString += onlySelected ? "1" : "0";

        const messageAsUint8Array = addBcc({
            messageAsUint8Array: new TextEncoder().encode(messageAsString)
        });

        const { statusCode, detectedCarriers } = await requestSlot(async () => {

            const ackResponse = await requestHandler.talk({
                requestAsUint8Array: messageAsUint8Array,
                tryParse: tryParseDetectCarriersExtendedAckResponse,
                timeoutMs
            });

            if (ackResponse.status !== ACK) {
                return {
                    statusCode: ackResponse.statusCode,
                    detectedCarriers: undefined
                };
            }

            if (ackResponse.dataType !== requestedDataType) {
                throw Error(`expected dataType to be ${requestedDataType}`);
            }

            let hasMore = true;
            let numberOfCarriersLeft = ackResponse.numberOfCarriers;

            let detectedCarriers = [];

            while (hasMore) {
                const packet = await requestHandler.talk({
                    requestAsUint8Array: new Uint8Array([STX]),
                    tryParse: ({ buffer }) => {
                        return tryParseDetectCarriersExtendedPacket({
                            buffer,
                            numberOfCarriersLeft
                        });
                    },
                    timeoutMs: 5000
                });

                const { carriers } = parseDataBlock({ dataBlock: packet.dataBlock, dataType: requestedDataType });
                detectedCarriers = [
                    ...detectedCarriers,
                    ...carriers
                ];

                numberOfCarriersLeft -= carriers.length;

                if (numberOfCarriersLeft < 0) {
                    throw Error("received more carriers than expected");
                }

                if (packet.packetNumber === packet.numberOfPackets) {
                    // last packet
                    hasMore = false;
                } else if (packet.packetNumber > packet.numberOfPackets) {
                    throw Error("packetNumber must not be greater than numberOfPackets");
                } else {
                    // request next packet
                    hasMore = true;
                }
            }

            if (numberOfCarriersLeft !== 0) {
                throw Error("discrepancy between reported number of carriers in header and carriers received");
            }

            return {
                statusCode: statusCodes.OK,
                detectedCarriers
            };
        });

        return {
            statusCode,
            detectedCarriers
        };
    };

    const requestChangeAsyncOperationParameter = ({
        antennaNumber,

        asynchronous,
        comesMessage,
        goesMessage,
        cumulate
    }) => {

        let value = 0x00;

        if (asynchronous) {
            value = value | 0x01;
        }

        if (comesMessage) {
            value = value | 0x02;
        }

        if (goesMessage) {
            value = value | 0x04;
        }

        if (cumulate) {
            value = value | 0x08;
        }

        return requestChangeDeviceParameter({
            antennaNumber,
            parameterNumber: 0x1006,
            value: new Uint8Array([value])
        });
    };

    const readDigitalInputPin = ({ pinNumber }) => {
        if ([2, 4].indexOf(pinNumber) < 0) {
            throw new Error(`pinNumber must be either 2 or 4`);
        }

        const enc = new TextEncoder();

        let requestAsString = "*";
        requestAsString += formatNumberAsString({ number: pinNumber, radix: 10, length: 1 });

        const requestAsUint8Array = addBcc({
            messageAsUint8Array: enc.encode(requestAsString)
        });

        return requestSlot(async () => {
            const { status, statusCode } = await requestHandler.talk({
                requestAsUint8Array,
                tryParse: tryParseStatusResponse,
                timeoutMs: 2000
            });

            if (status === ACK) {
                if (statusCode !== statusCodes.OK) {
                    throw Error(`got ACK but status code other than OK`);
                }
            } else {
                if (statusCode === statusCodes.OK) {
                    throw Error("got NACK but status code was OK");
                }

                return {
                    statusCode,
                    value: undefined
                };
            }

            const { value } = await requestHandler.talk({
                requestAsUint8Array: new Uint8Array([STX]),
                tryParse: ({ buffer }) => {
                    if (buffer.length < 3) {
                        return undefined;
                    }

                    const bcc = buffer[2];
                    const calculatedBcc = calculateBcc({ messageAsUint8Array: buffer.subarray(0, 2) });
                    if (bcc !== calculatedBcc) {
                        throw Error(`expected bcc to be ${calculatedBcc} but was ${bcc}`);
                    }

                    const valueAsByte = buffer[1];

                    let value;

                    if (valueAsByte === 0) {
                        value = false;
                    } else if (valueAsByte === 1) {
                        value = true;
                    } else {
                        throw Error(`expected value to be either 0 or 1 but was ${valueAsByte}`);
                    }

                    return {
                        value
                    };
                },
                timeoutMs: 2000
            });

            return {
                statusCode,
                value
            };
        });
    };

    const readIoLinkMasterConfig = () => {
        const enc = new TextEncoder();
        const requestAsString = "#";

        const requestAsUint8Array = addBcc({
            messageAsUint8Array: enc.encode(requestAsString)
        });

        return requestSlot(async () => {
            const { status, statusCode } = await requestHandler.talk({
                requestAsUint8Array,
                tryParse: tryParseStatusResponse,
            });

            if (statusCode !== statusCodes.OK) {
                return {
                    statusCode,
                    ioLinkMasterConfig: undefined
                };
            }

            const { ioLinkMasterConfig } = await requestHandler.talk({
                requestAsUint8Array: new Uint8Array([STX]),
                timeoutMs: 2000,
                tryParse: ({ buffer }) => {

                    if (buffer.length < 42) {
                        return undefined;
                    }

                    const bcc = buffer[41];
                    const calculatedBcc = calculateBcc({ messageAsUint8Array: buffer.subarray(0, 41) });

                    if (bcc !== calculatedBcc) {
                        throw Error(`expected bcc to be ${calculatedBcc} but was ${bcc}`);
                    }

                    const cycleTimeBase = parseNumberFromAscii({
                        ascii: buffer.subarray(1, 2),
                        radix: 10,
                        range: {
                            min: 0,
                            max: 2
                        }
                    });

                    const cycleTime = parseNumberFromAscii({
                        ascii: buffer.subarray(2, 4),
                        radix: 10,
                        range: {
                            min: 0,
                            max: 63
                        }
                    });

                    const pin4Mode = parseNumberFromAscii({
                        ascii: buffer.subarray(4, 5),
                        radix: 10,
                        range: {
                            min: 0,
                            max: 6
                        }
                    });

                    const pin2Mode = parseNumberFromAscii({
                        ascii: buffer.subarray(5, 6),
                        radix: 10,
                        range: {
                            min: 0,
                            max: 6
                        }
                    });

                    const safeState = parseNumberFromAscii({
                        ascii: buffer.subarray(6, 7),
                        radix: 10,
                        range: {
                            min: 0,
                            max: 2
                        }
                    });

                    const validationMode = parseNumberFromAscii({
                        ascii: buffer.subarray(7, 8),
                        radix: 10,
                        range: {
                            min: 0,
                            max: 2
                        }
                    });

                    const parameterServerMode = parseNumberFromAscii({
                        ascii: buffer.subarray(8, 9),
                        radix: 10,
                        range: {
                            min: 0,
                            max: 2
                        }
                    });

                    const parameterUploadEnabled = parseBooleanFromAscii({
                        ascii: buffer.subarray(9, 10)
                    });

                    const parameterDownloadEnabled = parseBooleanFromAscii({
                        ascii: buffer.subarray(10, 11)
                    });

                    const vendorId = parseNumberFromAscii({
                        ascii: buffer.subarray(11, 15),
                        radix: 16,
                        range: {
                            min: 0x0000,
                            max: 0xFFFF
                        }
                    });

                    const deviceId = parseNumberFromAscii({
                        ascii: buffer.subarray(15, 21),
                        radix: 16,
                        range: {
                            min: 0x0000,
                            max: 0xFFFFFF
                        }
                    });

                    const outputLength = parseNumberFromAscii({
                        ascii: buffer.subarray(21, 23),
                        radix: 10,
                        range: {
                            min: 0,
                            max: 32
                        }
                    });

                    const inputLength = parseNumberFromAscii({
                        ascii: buffer.subarray(23, 25),
                        radix: 10,
                        range: {
                            min: 0,
                            max: 32
                        }
                    });

                    const dec = new TextDecoder();
                    const serialNumber = dec.decode(buffer.subarray(25, 41));

                    const ioLinkMasterConfig = {
                        cycleTimeBase,
                        cycleTime,
                        pin4Mode,
                        pin2Mode,
                        safeState,
                        validationMode,
                        parameterServerMode,
                        parameterUploadEnabled,
                        parameterDownloadEnabled,
                        vendorId,
                        deviceId,
                        outputLength,
                        inputLength,
                        serialNumber
                    };

                    return {
                        ioLinkMasterConfig
                    };
                },
            });

            return {
                statusCode,
                ioLinkMasterConfig
            };
        });
    };

    const writeIoLinkMasterConfig = ({ ioLinkMasterConfig }) => {
        const enc = new TextEncoder();

        let requestAsString = "g";
        requestAsString += formatNumberAsString({ number: ioLinkMasterConfig.cycleTimeBase, radix: 10, length: 1 });
        requestAsString += formatNumberAsString({ number: ioLinkMasterConfig.cycleTime, radix: 10, length: 2 });
        requestAsString += formatNumberAsString({ number: ioLinkMasterConfig.pin4Mode, radix: 10, length: 1 });
        requestAsString += formatNumberAsString({ number: ioLinkMasterConfig.pin2Mode, radix: 10, length: 1 });
        requestAsString += formatNumberAsString({ number: ioLinkMasterConfig.safeState, radix: 10, length: 1 });
        requestAsString += formatNumberAsString({ number: ioLinkMasterConfig.validationMode, radix: 10, length: 1 });
        requestAsString += formatNumberAsString({ number: ioLinkMasterConfig.parameterServerMode, radix: 10, length: 1 });
        requestAsString += ioLinkMasterConfig.parameterUploadEnabled ? "1" : "0";
        requestAsString += ioLinkMasterConfig.parameterDownloadEnabled ? "1" : "0";
        requestAsString += formatNumberAsString({ number: ioLinkMasterConfig.vendorId, radix: 16, length: 4 });
        requestAsString += formatNumberAsString({ number: ioLinkMasterConfig.deviceId, radix: 16, length: 6 });
        requestAsString += formatNumberAsString({ number: ioLinkMasterConfig.outputLength, radix: 10, length: 2 });
        requestAsString += formatNumberAsString({ number: ioLinkMasterConfig.inputLength, radix: 10, length: 2 });

        if (ioLinkMasterConfig.serialNumber.length !== 16) {
            throw new Error(`serialNumber must be 16 characters long`);
        }
        requestAsString += ioLinkMasterConfig.serialNumber;

        const requestAsUint8Array = addBcc({
            messageAsUint8Array: enc.encode(requestAsString)
        });

        return requestSlot(async () => {
            const { status, statusCode } = await requestHandler.talk({
                requestAsUint8Array,
                tryParse: tryParseStatusResponse,
            });

            if (statusCode !== statusCodes.OK) {
                return {
                    statusCode
                };
            }

            const { status: status2, statusCode: statusCode2 } = await requestHandler.talk({
                requestAsUint8Array: new Uint8Array([STX]),
                tryParse: tryParseStatusResponse,
                timeoutMs: 15000
            });

            return {
                statusCode: statusCode2
            };
        });
    };

    const writeIoLinkCyclicProcessData = async ({ offset, data }) => {
        const enc = new TextEncoder();

        let requestAsString = "X";
        requestAsString += formatNumberAsString({ number: offset, radix: 10, length: 3 });
        requestAsString += formatNumberAsString({ number: data.length, radix: 10, length: 3 });

        const requestAsUint8Array = addBcc({
            messageAsUint8Array: enc.encode(requestAsString)
        });

        return requestSlot(async () => {
            const { status, statusCode } = await requestHandler.talk({
                requestAsUint8Array,
                tryParse: tryParseStatusResponse,
            });

            if (statusCode !== statusCodes.OK) {
                return {
                    statusCode
                };
            }

            const payloadPacket = addBcc({
                messageAsUint8Array: new Uint8Array([
                    STX,
                    ...data
                ])
            });

            const { status: status2, statusCode: statusCode2 } = await requestHandler.talk({
                requestAsUint8Array: payloadPacket,
                tryParse: tryParseStatusResponse,
            });

            return {
                statusCode: statusCode2
            };
        });
    };

    const writeIoLinkAcylicData = async ({ index, subIndex, data }) => {
        const enc = new TextEncoder();

        let requestAsString = "e";
        requestAsString += formatNumberAsString({ number: index, radix: 16, length: 4 });
        requestAsString += formatNumberAsString({ number: subIndex, radix: 16, length: 4 });
        requestAsString += formatNumberAsString({ number: data.length, radix: 10, length: 3 });

        const requestAsUint8Array = addBcc({
            messageAsUint8Array: enc.encode(requestAsString)
        });

        return requestSlot(async () => {
            const { status, statusCode } = await requestHandler.talk({
                requestAsUint8Array,
                tryParse: tryParseStatusResponse,
            });

            if (statusCode !== statusCodes.OK) {
                return {
                    statusCode
                };
            }

            const payloadPacket = addBcc({
                messageAsUint8Array: new Uint8Array([
                    STX,
                    ...data
                ])
            });

            const { status: status2, statusCode: statusCode2 } = await requestHandler.talk({
                requestAsUint8Array: payloadPacket,
                tryParse: tryParseStatusResponse,
            });

            return {
                statusCode: statusCode2
            };
        });
    };

    let connCheckTimeoutHandle = undefined;

    // request a parameter every second to check connection is still alive
    const checkConnection = () => {
        if (connCheckTimeoutHandle !== undefined) {
            clearTimeout(connCheckTimeoutHandle);
        }

        connCheckTimeoutHandle = setTimeout(() => {
            readDeviceParameters({ antennaNumber: 1, parameterNumber: 1 }).then(() => {
                checkConnection();
            }, (err) => {
                // unused
            });
        }, 1000);
    };

    const close = () => {
        if (closed) {
            throw Error("connection already closed");
        }

        closed = true;

        if (emittedError !== undefined) {
            throw Error("can't close as connection already failed", { cause: emittedError });
        }

        rejectPendingRequests({ error: Error("connection closed by user decision") });
        teardown();
    };

    return {
        readDeviceParameters,
        requestChangeDeviceParameter,
        detectDataCarriersExtended,

        requestChangeAsyncOperationParameter,

        readDigitalInputPin,
        readIoLinkMasterConfig,
        writeIoLinkMasterConfig,
        writeIoLinkCyclicProcessData,
        writeIoLinkAcylicData,

        close
    };
};

module.exports = {
    connect,
    statusCodes,
    errorFromStatusCode
};
