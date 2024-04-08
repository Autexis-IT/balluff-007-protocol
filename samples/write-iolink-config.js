const { connect: connectBaluff, statusCodes, errorFromStatusCode } = require("../lib/index.js");

const conn = connectBaluff({
    ipAddress: "192.168.10.2",
    port: 10003,

    onConnect: async () => {
        console.log("connected!");

        const newIoLinkMasterConfig = {
            cycleTimeBase: 0,
            cycleTime: 0,
            pin4Mode: 4,
            pin2Mode: 0,
            safeState: 0,
            validationMode: 0,
            parameterServerMode: 0,
            parameterUploadEnabled: false,
            parameterDownloadEnabled: false,
            vendorId: 0x0378,
            deviceId: 0x050A09,
            outputLength: 8,
            inputLength: 1,
            serialNumber: "0000000000000000"
        };

        const { statusCode } = await conn.writeIoLinkMasterConfig({
            ioLinkMasterConfig: newIoLinkMasterConfig
        });

        console.log("io link master config write result", { statusCode });

        if (statusCode !== statusCodes.OK) {

            console.error(errorFromStatusCode({ statusCode }));

            conn.close();
            return;
        }

        const { statusCode: statusCode2, ioLinkMasterConfig } = await conn.readIoLinkMasterConfig();

        console.log("io link master config read back", { statusCode: statusCode2, ioLinkMasterConfig });

        conn.close();
    },

    onError: (err) => {
        console.error("baluff error", err);
        conn.close();
    }
});
