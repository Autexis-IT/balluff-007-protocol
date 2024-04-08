const { EOT, ACK, NAK } = require("./constants.js");
const { calculateBcc } = require("./bcc.js");

const formatNumberAsString = ({ number, radix, length }) => {
    if (number === undefined || isNaN(number)) {
        throw new Error(`value must be a number`);
    }

    const numberAsString = number.toString(radix);

    if (numberAsString.length > length) {
        throw new Error(`numberAsString.length must be less than or equal to ${length}`);
    }

    return numberAsString.padStart(length, "0");
};

const parseNumberFromAscii = ({ ascii, radix, range, name }) => {
    const dec = new TextDecoder();

    const numberAsString = dec.decode(ascii);
    const number = parseInt(numberAsString, radix);

    if (isNaN(number)) {
        throw Error(`expected ${name} to be a number`);
    }

    if (number > range.max) {
        throw Error(`expected ${name} to be less than or equal to ${range.max}`);
    }

    if (number < range.min) {
        throw Error(`expected ${name} to be greater than or equal to ${range.min}`);
    }

    return number;
};

const parseBooleanFromAscii = ({ ascii, name }) => {
    const number = parseNumberFromAscii({ ascii, radix: 10, range: { min: 0, max: 1 }, name });
    return number === 1;
};

const tryParseStatusResponse = ({ buffer }) => {
    if (buffer.length < 2) {
        return undefined;
    }

    if (buffer.length > 2) {
        throw Error("too many bytes received");
    }

    const status = buffer[0];

    if ([ACK, NAK].indexOf(status) < 0) {
        throw Error(`expected status to be ${ACK} or ${NACK} but was ${status}`);
    }

    const statusCode = buffer[1];

    return {
        status,
        statusCode
    };
};

const tryParseStatusResponseWithBcc = ({ buffer }) => {

    if (buffer.length < 3) {
        return undefined;
    }

    if (buffer.length > 3) {
        throw Error("too many bytes received");
    }

    const bcc = buffer[2];
    const calculatedBcc = calculateBcc({ messageAsUint8Array: buffer.subarray(0, 2) });
    if (bcc !== calculatedBcc) {
        throw Error(`expected bcc to be ${calculatedBcc} but was ${bcc}`);
    }

    return tryParseStatusResponse({ buffer: buffer.subarray(0, 2) });
};

const tryParseDetectCarriersExtendedAckResponse = ({ buffer }) => {
    if (buffer.length < 1) {
        return;
    }

    const status = buffer[0];

    if (status === NAK) {
        return tryParseStatusResponse({ buffer });
    }

    if (buffer.length < 9) {
        return;
    }

    const dec = new TextDecoder();

    const antennaNumberAsString = dec.decode(buffer.subarray(1, 2));
    const antennaNumber = parseInt(antennaNumberAsString, 10);

    if (isNaN(antennaNumber)) {
        throw Error(`expected antennaNumber to be a number`);
    }

    const dataTypeAsString = dec.decode(buffer.subarray(2, 3));
    const dataType = dataTypeAsString;

    const numberOfCarriersAsString = dec.decode(buffer.subarray(3, 6));
    const numberOfCarriers = parseInt(numberOfCarriersAsString, 10);

    if (isNaN(numberOfCarriers)) {
        throw Error(`expected numberOfCarriers to be a number`);
    }

    const numberOfBytesPerCarrierAsString = dec.decode(buffer.subarray(6, 8));
    const numberOfBytesPerCarrier = parseInt(numberOfBytesPerCarrierAsString, 10);

    if (isNaN(numberOfBytesPerCarrier)) {
        throw Error(`expected numberOfBytesPerCarrier to be a number`);
    }

    if (numberOfBytesPerCarrier !== 64) {
        throw Error(`expected numberOfBytesPerCarrier to be 64`);
    }

    const bcc = buffer[8];
    const calculatedBcc = calculateBcc({ messageAsUint8Array: buffer.subarray(0, 8) });

    if (bcc !== calculatedBcc) {
        throw Error(`expected bcc to be ${calculatedBcc} but was ${bcc}`);
    }

    return {
        status,
        antennaNumber,
        dataType,
        numberOfCarriers,
        numberOfBytesPerCarrier
    };
};

const tryParseDetectCarriersExtendedPacket = ({ buffer, numberOfCarriersLeft }) => {
    if (numberOfCarriersLeft === undefined) {
        throw Error(`numberOfCarriersLeft must be given`);
    }

    if (buffer.length < 14) {
        return undefined;
    }

    let offset = 0;

    // documentation says ACK, but in reality EOT is delivered
    if ([EOT, ACK].indexOf(buffer[offset]) < 0) {
        throw Error(`expected 0x06 (<ACK>) or 0x04 (<EOT>) as first byte of packet`);
    }

    offset += 1;

    const dec = new TextDecoder();

    // documentation says antenna number is part of the packet, but in reality it is not

    // const antennaNumberAsString = dec.decode(buffer.subarray(offset, offset + 1));
    // const antennaNumber = parseInt(antennaNumberAsString, 10);
    // offset += 2;

    // if (isNaN(antennaNumber)) {
    //     throw Error(`expected antennaNumber to be a number`);
    // }

    const numberOfPacketsAsString = dec.decode(buffer.subarray(offset, offset + 3));
    const numberOfPackets = parseInt(numberOfPacketsAsString, 10);
    offset += 3;

    if (isNaN(numberOfPackets)) {
        throw Error(`expected numberOfPackets to be a number`);
    }

    const packetNumberAsString = dec.decode(buffer.subarray(offset, offset + 3));
    const packetNumber = parseInt(packetNumberAsString, 10);
    offset += 3;

    if (isNaN(packetNumber)) {
        throw Error(`expected packetNumber to be a number`);
    }

    const numberOfBytesAsString = dec.decode(buffer.subarray(offset, offset + 6));
    const numberOfBytesByPacket = parseInt(numberOfBytesAsString, 10);
    offset += 6;

    if (isNaN(numberOfBytesByPacket)) {
        throw Error(`expected numberOfBytes to be a number`);
    }

    let numberOfBytes = numberOfBytesByPacket;

    const maxNumberOfBytesByCarriersLeft = numberOfCarriersLeft * 84;

    // HACK: packets 1 and 2 report correct number of bytes,
    // but packets 3 and up report 1008 bytes, despite having less data
    // In this case, we truncate the data to the correct length
    if (packetNumber > 2 && numberOfBytesByPacket > maxNumberOfBytesByCarriersLeft) {
        console.warn(`ẀARN: HACK: truncating number of bytes from ${numberOfBytesByPacket} to ${maxNumberOfBytesByCarriersLeft}, as only ${numberOfCarriersLeft} carriers are left to be read`);
        numberOfBytes = maxNumberOfBytesByCarriersLeft;
    } else if (numberOfBytes > maxNumberOfBytesByCarriersLeft) {
        throw Error(`number of bytes (${numberOfBytes}) is greater than the maximum expected number of bytes (${maxNumberOfBytesByCarriersLeft})`);
    }

    const totalBytesExpected = offset + numberOfBytes + 1;

    if (buffer.length < totalBytesExpected) {
        return undefined;
    } else if (buffer.length > totalBytesExpected) {
        throw Error(`too many bytes received, expected ${totalBytesExpected}, got ${buffer.length}, packet number ${packetNumber} of ${numberOfPackets}, carriers left ${numberOfCarriersLeft}, size in header ${numberOfBytesByPacket}, expected size ${numberOfBytes}, buffer length ${buffer.length}`);
    }

    const dataBlock = buffer.subarray(offset, offset + numberOfBytes);
    offset += numberOfBytes;

    // console.log({ numberOfPackets, packetNumber, numberOfBytes, dataBlock });

    const bcc = buffer[offset];
    const calculatedBcc = calculateBcc({ messageAsUint8Array: buffer.subarray(0, offset) });
    offset += 1;

    if (bcc !== calculatedBcc) {
        throw Error(`expected bcc to be ${calculatedBcc} but was ${bcc}, packet number ${packetNumber} of ${numberOfPackets}, carriers left ${numberOfCarriersLeft}, size in header ${numberOfBytesByPacket}, expected size ${numberOfBytes}, buffer length ${buffer.length}`);
    }

    return {
        // antennaNumber,
        numberOfPackets,
        packetNumber,
        numberOfBytes,
        dataBlock
    };
};

const parseAntennaMask = ({ antennaMask }) => {
    let antennas = [];

    for (let i = 0; i < 4; i += 1) {
        if ((antennaMask & (1 << i)) !== 0) {
            antennas = [
                ...antennas,
                i + 1
            ];
        }
    }

    return antennas;
};

const parseDataBlockFrame = ({ dataBlockFrame, dataType }) => {

    let offset = 0;
    const dec = new TextDecoder();

    const antennaMask = dataBlockFrame[offset];
    offset += 1;

    const antennasWhereCarrierWasDetected = parseAntennaMask({ antennaMask });

    const antennaWithHighestSignalStrengthAsString = dec.decode(dataBlockFrame.subarray(1, 2));
    const antennaWithHighestSignalStrength = parseInt(antennaWithHighestSignalStrengthAsString, 10);
    offset += 1;

    if (isNaN(antennaWithHighestSignalStrength)) {
        throw Error(`expected antennaWithHighestSignalStrength to be a number`);
    }

    const epcOrTidLength = dataBlockFrame[offset];
    if (epcOrTidLength > 62) {
        throw Error(`epc or tid length must be less than or equal to 62`);
    }
    const epcOrTidLE = dataBlockFrame.subarray(offset + 64 - epcOrTidLength, offset + 64);

    const epcOrTid = Buffer.alloc(epcOrTidLength);
    for (let i = 0; i < epcOrTidLength; i += 1) {
        epcOrTid[i] = epcOrTidLE[epcOrTidLength - 1 - i];
    }

    const epc = dataType === "E" ? epcOrTid : undefined;
    const tid = dataType === "T" ? epcOrTid : undefined;

    offset += 64;

    const PC = dataBlockFrame[offset] << 8 | dataBlockFrame[offset + 1];
    offset += 2;

    const XPC_w1 = dataBlockFrame[offset] << 8 | dataBlockFrame[offset + 1];
    offset += 2;

    const XPC_w2 = dataBlockFrame[offset] << 8 | dataBlockFrame[offset + 1];
    offset += 2;

    const rssiAsString = dec.decode(dataBlockFrame.subarray(offset, offset + 3));
    const rssi = parseInt(rssiAsString, 10);
    offset += 3;

    if (isNaN(rssi)) {
        throw Error(`expected rssi to be a number`);
    }

    if (rssi > 255) {
        throw Error(`rssi must be less than or equal to 255`);
    }

    const timestampAsString = dec.decode(dataBlockFrame.subarray(offset, offset + 9));
    const timestamp = parseInt(timestampAsString, 10);
    offset += 9;

    return {
        antennasWhereCarrierWasDetected,
        antennaWithHighestSignalStrength,
        epc,
        tid,
        PC,
        XPC_w1,
        XPC_w2,
        rssi,
        timestamp
    };
};

const parseDataBlock = ({ dataBlock, dataType }) => {

    const frameSize = 84;

    if (dataBlock.length % frameSize !== 0) {
        throw Error(`data block length must be a multiple of 84`);
    }

    const numberOfFrames = dataBlock.length / frameSize;

    let carriers = [];

    for (let i = 0; i < numberOfFrames; i += 1) {
        const offset = i * frameSize;

        const dataBlockFrame = dataBlock.subarray(offset, offset + frameSize);

        const carrier = parseDataBlockFrame({ dataBlockFrame, dataType });
        carriers = [
            ...carriers,
            carrier
        ];
    }

    return {
        carriers
    };
};

module.exports = {
    formatNumberAsString,
    parseNumberFromAscii,
    parseBooleanFromAscii,

    tryParseStatusResponse,
    tryParseStatusResponseWithBcc,

    tryParseDetectCarriersExtendedAckResponse,
    tryParseDetectCarriersExtendedPacket,

    parseDataBlock,
    parseDataBlockFrame,
    parseAntennaMask,
};
