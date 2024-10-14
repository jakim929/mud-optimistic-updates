import { Hex, Log } from 'viem'
import { FieldLayout } from './FieldLayout'
import { ExecResult } from 'tevm/evm'
import { StoreEventsAbiItem, StoreEventsAbi } from '@latticexyz/store'

type StoreLog = Pick<
  Log<bigint, number, false, StoreEventsAbiItem, true, StoreEventsAbi>,
  'address' | 'eventName' | 'args'
>

type StoreExecResult = {
  logs: StoreLog[]
}

type ResourceId = Hex

// Only implements the fieldLayout-specified methods

// TODO: unimplemented
// dynamic fields
// offchain tables

export class StoreCore {
  private address: Hex

  constructor(address: Hex) {
    this.address = address
  }

  async setField(
    tableId: ResourceId,
    keyTuple: readonly Hex[],
    fieldIndex: number,
    data: Hex,
    fieldLayout: FieldLayout,
  ): Promise<StoreExecResult> {
    if (fieldIndex < fieldLayout.numStaticFields()) {
      return this.setStaticField(
        tableId,
        keyTuple,
        fieldIndex,
        data,
        fieldLayout,
      )
    } else {
      return this.setDynamicField(tableId, keyTuple, fieldIndex, data)
    }
  }

  async setStaticField(
    tableId: ResourceId,
    keyTuple: readonly Hex[],
    fieldIndex: number,
    data: Hex,
    fieldLayout: FieldLayout,
  ): Promise<StoreExecResult> {
    const start = Number(getStaticDataOffset(fieldLayout, fieldIndex))
    return await this.spliceStaticData(tableId, keyTuple, start, data)
  }

  async setDynamicField(
    tableId: ResourceId,
    keyTuple: readonly Hex[],
    fieldIndex: number,
    data: Hex,
  ): Promise<StoreExecResult> {
    throw new Error('setDynamicField unimplemented')
  }

  async spliceStaticData(
    tableId: ResourceId,
    keyTuple: readonly Hex[],
    start: number,
    data: Hex,
  ): Promise<StoreExecResult> {
    const log: StoreLog = {
      address: this.address,
      eventName: 'Store_SpliceStaticData',
      args: {
        tableId: tableId,
        keyTuple: keyTuple,
        start: start,
        data: data,
      },
    }

    console.log('StorePrecompile: emitting Store_SpliceStaticData', log)
    return { logs: [log] }
  }
}

const getStaticDataOffset = (
  fieldLayout: FieldLayout,
  fieldIndex: number,
): bigint => {
  let offset = 0n
  for (let i = 0n; i < BigInt(fieldIndex); i++) {
    offset += fieldLayout.atIndex(i)
  }
  return offset
}
