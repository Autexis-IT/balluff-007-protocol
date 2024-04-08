const { connect: connectBaluff, statusCodes, errorFromStatusCode } = require("../lib/index.js");

const conn = connectBaluff({
    ipAddress: "192.168.10.2",
    port: 10003,

    onConnect: async () => {
        console.log("connected!");

        const result = await conn.requestChangeAsyncOperationParameter({
            antennaNumber: 0,

            // asynchronous: true,
            // comesMessage: false,
            // goesMessage: false,
            // cumulate: true

            asynchronous: false,
            comesMessage: false,
            goesMessage: false,
            cumulate: false
        });

        while (true) {
            console.log("trying to detect carriers...");

            const detectionResult = await conn.detectDataCarriersExtended({
                antennaNumber: 0,
                dataType: "E",
                maxNumberCarriers: 999,
                onlySelected: false
            });

            console.log({ detectionResult });

            if (detectionResult.statusCode !== statusCodes.OK) {
                console.error("failed to detect carriers:", errorFromStatusCode({ statusCode: detectionResult.statusCode }));
            } else {
                detectionResult.detectedCarriers.forEach((carrier) => {

                    const antennaText = "- antennas " + [1, 2].map((antennaNumber) => {
                        if (carrier.antennaWithHighestSignalStrength === antennaNumber) {
                            return `(!) ${antennaNumber}`
                        } else if (carrier.antennasWhereCarrierWasDetected.includes(antennaNumber)) {
                            return `(X) ${antennaNumber}`
                        } else {
                            return `(/) ${antennaNumber}`;
                        }
                    }).join(" ");

                    console.log(`detected carrier ${carrier.epc.toString("hex")} at timestamp ${carrier.timestamp} with RSSI ${carrier.rssi} ${antennaText}`);
                });
            }

            await new Promise((resolve) => setTimeout(resolve, 5000));
        }
    },

    onError: (err) => {
        console.error("baluff error", err);
        conn.close();
    }
});
