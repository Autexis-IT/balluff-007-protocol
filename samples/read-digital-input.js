const { connect: connectBaluff, statusCodes, errorFromStatusCode } = require("../lib/index.js");

const conn = connectBaluff({
    ipAddress: "192.168.10.2",
    port: 10003,

    onConnect: async () => {
        console.log("connected!");

        const { statusCode: sc1, ioLinkMasterConfig } = await conn.readIoLinkMasterConfig();

        console.log("io link master config", { sc1, ioLinkMasterConfig });

        while (true) {
            
            const { statusCode, value } = await conn.readDigitalInputPin({ pinNumber: 2 });

            console.log("read digital input", { statusCode, value });

            await new Promise((resolve) => setTimeout(resolve, 5000));
        }
    },

    onError: (err) => {
        console.error("baluff error", err);
        conn.close();
    }
});
