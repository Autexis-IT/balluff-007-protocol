
const statusCodes = {
    OK: 0x30,
    NO_CARRIER_IN_RANGE: 0x31,
    READING_NOT_POSSIBLE: 0x32,
    CARRIER_REMOVED_DURING_READING: 0x33,
    CANNOT_WRITE_TO_CARRIER: 0x34,
    CARRIER_REMOVED_DURING_WRITING: 0x35,
    HARDWARE_PROBLEM: 0x36,
    SENT_DATA_DOES_NOT_COMPLY_WITH_007_PROTOCOL: 0x37,
    BCC_OF_RECEIVED_DATA_DOES_NOT_MATCH_TRANSMITTED_BCC: 0x38,
    CABLE_BREAK_ON_ACTIVE_ANTENNA_PORT_OR_NO_ANTENNA_CONNECTED: 0x39,
    MORE_THAN_1_CARRIER_IN_DETECTION_RANGE: 0x41,
    INTERNAL_DEVICE_ERROR: 0x44,
    CRC_OR_SIGNATURE_OF_CARRIER_INCORRECT: 0x45,
    SELECTED_MEMORY_AREA_NOT_SUPPORTED_BY_CARRIER: 0x46,
    SELECTED_ANTENNA_NOT_ACTIVE: 0x4E,
    COMMAND_EXECUTED_ON_WRONG_ETHERNET_PORT: 0x50,
    COMMAND_OR_PARAMETER_NOT_SUPPORTED_BY_PROCESSOR_UNIT: 0x53,
    ACCESS_DENIED: 0x58,
    DEVICE_NOT_IN_STATE_TO_EXECUTE_COMMAND: 0x59,
    FUNCTION_NOT_SUPPORTED_BY_CARRIER: 0x61,
    INCORRECT_OR_INVALID_LICENSE_KEY: 0x62
};

const errorMessagesByStatusCode = {
    [statusCodes.NO_CARRIER_IN_RANGE]: "No data carrier in the detection range of the antenna.",
    [statusCodes.READING_NOT_POSSIBLE]: "Reading of data carrier not possible.",
    [statusCodes.CARRIER_REMOVED_DURING_READING]: "Data carrier was removed from the detection range of the antenna during reading.",
    [statusCodes.CANNOT_WRITE_TO_CARRIER]: "Cannot write to the data carrier.",
    [statusCodes.CARRIER_REMOVED_DURING_WRITING]: "Data carrier was removed from the detection range of the antenna during writing.",
    [statusCodes.HARDWARE_PROBLEM]: "The device has detected a hardware problem.",
    [statusCodes.SENT_DATA_DOES_NOT_COMPLY_WITH_007_PROTOCOL]: "Sent data does not comply with 007 protocol.",
    [statusCodes.BCC_OF_RECEIVED_DATA_DOES_NOT_MATCH_TRANSMITTED_BCC]: "BCC of the received data does not match the transmitted BCC.",
    [statusCodes.CABLE_BREAK_ON_ACTIVE_ANTENNA_PORT_OR_NO_ANTENNA_CONNECTED]: "Cable break on an active antenna port or no antenna connected.",
    [statusCodes.MORE_THAN_1_CARRIER_IN_DETECTION_RANGE]: "There is more than 1 data carrier in the detection range of the antenna(s) (only for single tag operations).",
    [statusCodes.INTERNAL_DEVICE_ERROR]: "Internal device error.",
    [statusCodes.CRC_OR_SIGNATURE_OF_CARRIER_INCORRECT]: "CRC or signature of the data carrier incorrect.",
    [statusCodes.SELECTED_MEMORY_AREA_NOT_SUPPORTED_BY_CARRIER]: "The selected memory area is not supported by the data carrier.",
    [statusCodes.SELECTED_ANTENNA_NOT_ACTIVE]: "The selected antenna is not active.",
    [statusCodes.COMMAND_EXECUTED_ON_WRONG_ETHERNET_PORT]: "The command was executed on the wrong Ethernet port.",
    [statusCodes.COMMAND_OR_PARAMETER_NOT_SUPPORTED_BY_PROCESSOR_UNIT]: "The command or parameter is not supported by the processor unit.",
    [statusCodes.ACCESS_DENIED]: "Access denied. The current user level does not allow this action.",
    [statusCodes.DEVICE_NOT_IN_STATE_TO_EXECUTE_COMMAND]: "The device is currently in a state that does not allow the command to be executed.",
    [statusCodes.FUNCTION_NOT_SUPPORTED_BY_CARRIER]: "This function is not supported by the data carrier",
    [statusCodes.INCORRECT_OR_INVALID_LICENSE_KEY]: "Incorrect or invalid license key"
};

const errorFromStatusCode = ({ statusCode }) => {

    if (statusCode === statusCodes.OK) {
        throw Error("not an erroneous status code");
    }

    const errorMessage = errorMessagesByStatusCode[statusCode] || "unknown error";

    const err = Error(`${errorMessage} (0x${statusCode.toString(16)})`)
    err.statusCode = statusCode;

    return err;
};

module.exports = {
    statusCodes,
    errorFromStatusCode
};
