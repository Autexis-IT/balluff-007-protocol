const multiPartRequest = ({ connection, onError }) => {

    let currentPart = undefined;
    let failed = false;


    let buffer = Buffer.alloc(0);

    connection.on("data", (data) => {
        if (failed) {
            return;
        }

        if (currentPart === undefined) {
            onError(Error("unexpected data"));
            return;
        }

        buffer = Buffer.concat([buffer, data]);

        try {
            const result = currentPart.tryParse({ buffer });
            if (result !== undefined) {
                buffer = Buffer.alloc(0);
                currentPart.resolve(result);
            }
        } catch (ex) {
            currentPart.reject(ex);
        }
    });

    const talk = ({ requestAsUint8Array, tryParse, timeoutMs = 5000 }) => {
        if (failed) {
            throw Error("already failed");
        }

        if (currentPart !== undefined) {
            throw Error("already waiting for response");
        }

        return new Promise((resolve, reject) => {
            currentPart = {
                tryParse,
                resolve: (result) => {
                    currentPart = undefined;
                    clearTimeout(timeoutHandle);
                    resolve(result);
                },
                reject: (err) => {
                    currentPart = undefined;
                    clearTimeout(timeoutHandle);

                    reject(err);
                    onError(err);
                }
            };

            connection.write(requestAsUint8Array);

            const timeoutHandle = setTimeout(() => {
                currentPart.reject(Error(`timeout after ${timeoutMs}ms`));
            }, timeoutMs);
        });
    };

    const maybeFail = ({ error }) => {
        failed = true;
        currentPart?.reject(error);
    };

    return {
        talk,
        maybeFail
    };
};

module.exports = {
    multiPartRequest
};
