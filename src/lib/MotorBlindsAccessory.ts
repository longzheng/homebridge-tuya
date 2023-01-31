import { Categories, CharacteristicGetCallback, CharacteristicSetCallback, CharacteristicValue } from "homebridge";

import BaseAccessory from './BaseAccessory';

const BLINDS_CMD_OPEN = 'open';
const BLINDS_CMD_CLOSE = 'close';
const BLINDS_CMD_STOP = 'stop';
const BLINDS_STATE_OPENING = 'opening';
const BLINDS_STATE_CLOSING = 'closing';

const DEVICE_POSITION_OPEN = 0;
const DEVICE_POSITION_CLOSE = 100;
const HOMEKIT_POSITION_OPEN = 100;
const HOMEKIT_POSITION_CLOSE = 0;

// value changes to 'open' or 'close' when command is set
const BLINDS_DP_COMMAND = 1;
// value changes to 0-100 when position is set
// however when blind is set to fully closed or open, the target position is not 0 or 100 but the previously set target
const BLINDS_DP_POSITION_TARGET = 2;
// value changes to 0-100 when position is reached/finished
const BLINDS_DP_POSITION_STATUS = 3;
// value changes to 'opening' or 'closing' when position is set
const BLINDS_DP_STATE = 7;

class MotorBlindsAccessory extends BaseAccessory {
    private dpCommand: string | number;
    private dpPositionTarget: string | number;
    private dpPositionStatus: string | number;
    private dpState: string | number;
    private cmdOpen: string;
    private cmdClose: string;
    private cmdStop: string;
    private currentPosition: number = 0;
    private targetPosition: number = 0;

    static getCategory() {
        return Categories.WINDOW_COVERING;
    }

    constructor(...props: ConstructorParameters<typeof BaseAccessory>) {
        super(...props);

        this.dpCommand = this._getCustomDP(this.device.context.dpCommand) || BLINDS_DP_COMMAND;
        this.dpPositionTarget = this._getCustomDP(this.device.context.dpPositionTarget) || BLINDS_DP_POSITION_TARGET;
        this.dpPositionStatus = this._getCustomDP(this.device.context.dpPositionStatus) || BLINDS_DP_POSITION_STATUS;
        this.dpState = this._getCustomDP(this.device.context.dpState) || BLINDS_DP_STATE;

        this.cmdOpen = BLINDS_CMD_OPEN;
        if (this.device.context.cmdOpen) {
            this.cmdOpen = ('' + this.device.context.cmdOpen).trim();
        }

        this.cmdClose = BLINDS_CMD_CLOSE;
        if (this.device.context.cmdClose) {
            this.cmdClose = ('' + this.device.context.cmdClose).trim();
        }

        this.cmdStop = BLINDS_CMD_STOP;
        if (this.device.context.cmdStop) {
            this.cmdStop = ('' + this.device.context.cmdStop).trim();
        }
    }
    
    _registerPlatformAccessory() {
        const {Service} = this.hap;
        this.accessory.addService(Service.WindowCovering, this.device.context.name);
        super._registerPlatformAccessory();
    }

    override _registerCharacteristics(dps: any) {
        const {Service, Characteristic} = this.hap;
        const service = this.accessory.getService(Service.WindowCovering);

        if (!service) {
            throw new Error("Missing service")
        }

        this._checkServiceName(service, this.device.context.name);

        // Initialize position and state (assume target and current are equal at start).
        this.currentPosition = this.targetPosition = this.convertPositionNumber(dps[this.dpPositionStatus]);

        const characteristicCurrentPosition = service.getCharacteristic(Characteristic.CurrentPosition)
            .updateValue(this.currentPosition)
            .on('get', this.getCurrentPosition.bind(this));

        const characteristicTargetPosition = service.getCharacteristic(Characteristic.TargetPosition)
            .updateValue(this.currentPosition)
            .on('get', this.getTargetPosition.bind(this))
            .on('set', this.setTargetPosition.bind(this));

        const characteristicPositionState = service.getCharacteristic(Characteristic.PositionState)
            .updateValue(Characteristic.PositionState.STOPPED)

        this.device.on('change', changes => {
            if (this.dpState in changes) {
                // state changed
                const state: typeof BLINDS_STATE_OPENING | typeof BLINDS_STATE_CLOSING = changes[this.dpState];
                console.log("[TuyaAccessory] MotorBlinds " + this.device.context.name + " state changed to " + state);

                switch (state) {
                    case BLINDS_STATE_OPENING:
                        characteristicPositionState.updateValue(Characteristic.PositionState.INCREASING);
                        break;
                    case BLINDS_STATE_CLOSING:
                        characteristicPositionState.updateValue(Characteristic.PositionState.INCREASING);
                        break;
                }
            } else if (this.dpPositionTarget in changes) {
                // position target changed
                const positionTarget: number = this.convertPositionNumber(changes[this.dpPositionTarget]);
                console.log("[TuyaAccessory] MotorBlinds " + this.device.context.name + " position target change to " + positionTarget);
                
                this.targetPosition = positionTarget;
                characteristicTargetPosition.updateValue(this.targetPosition);
            } else if (this.dpPositionStatus in changes) {
                // position status changed
                const positionStatus: number = this.convertPositionNumber(changes[this.dpPositionStatus]);
                console.log("[TuyaAccessory] MotorBlinds " + this.device.context.name + " position status change to " + positionStatus);
                
                this.currentPosition = positionStatus;
                this.targetPosition = positionStatus;
                characteristicCurrentPosition.updateValue(this.currentPosition);

                // assume the target position is reached and position state has stopped
                characteristicPositionState.updateValue(Characteristic.PositionState.STOPPED);
            } else if (this.dpCommand in changes) {
                // command changed
                const command: typeof BLINDS_CMD_OPEN | typeof BLINDS_CMD_CLOSE | typeof BLINDS_CMD_STOP = changes[this.dpCommand];
                console.log("[TuyaAccessory] MotorBlinds " + this.device.context.name + " command change to " + command);

                switch(command) {
                    case 'open': {
                        this.targetPosition = HOMEKIT_POSITION_OPEN;
                        characteristicTargetPosition.updateValue(this.targetPosition);
                        break;
                    }
                    case 'close': {
                        this.targetPosition = HOMEKIT_POSITION_CLOSE;
                        characteristicTargetPosition.updateValue(this.targetPosition);
                        break;
                    }
                    case 'stop': {
                        // no op
                        break;
                    }
                }
            }
        });
    }

    getCurrentPosition(callback: CharacteristicGetCallback) {
        callback(null, this.currentPosition);
    }

    convertPositionNumber(position: number) {
        // Device counts percent closed: 0 = open, 100 = closed
        // HomeKit counts percent open: 100 = open, 0 = closed
        return 100 - position;
    }

    getTargetPosition(callback: CharacteristicGetCallback) {
        callback(null, this.targetPosition);
    }

    setTargetPosition(value: CharacteristicValue, callback: CharacteristicSetCallback) {
        if (typeof value !== 'number') {
            return callback(new Error('Expected target position to be a number'));
        }

        console.log('[TuyaAccessory] MotorBlinds ' + this.device.context.name + ' position target set to ' + value);

        this.targetPosition = this.convertPositionNumber(value);

        // Device expects stop with a position
        return this.setMultiState({
            [this.dpCommand.toString()]: this.cmdOpen,
            [this.dpPositionTarget.toString()]: this.targetPosition
        }, callback);
    }
}

module.exports = MotorBlindsAccessory;
export default MotorBlindsAccessory;
