const calculateBcc = ({ messageAsUint8Array }) => {
    let bccValue = 0x00;

    for (let loopCount = 0; loopCount <= messageAsUint8Array.length; loopCount++) {
        bccValue = bccValue ^ messageAsUint8Array[loopCount];
    }

    return bccValue;
};

const addBcc = ({ messageAsUint8Array }) => {
    const bcc = calculateBcc({ messageAsUint8Array });

    const messageWithBcc = new Uint8Array(messageAsUint8Array.length + 1);
    messageWithBcc.set(messageAsUint8Array);
    messageWithBcc[messageAsUint8Array.length] = bcc;

    return messageWithBcc;
};

module.exports = {
    calculateBcc,
    addBcc
};
