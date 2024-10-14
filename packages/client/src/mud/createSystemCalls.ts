/*
 * Create the system calls that the client can use to ask
 * for changes in the World state (using the System contracts).
 */

import {
  Address,
  Hex,
  Log,
  decodeAbiParameters,
  encodeAbiParameters,
  encodeFunctionData,
  hexToBytes,
  keccak256,
  pad,
  parseEventLogs,
  toBytes,
} from 'viem'
import { SetupNetworkResult } from './setupNetwork'
import { storeEventsAbi } from '@latticexyz/store'

// 0x629a4c26e296b22a8e0856e9f6ecb2d1008d7e00081111962cd175fa7488e175
const STORAGE_SLOT = keccak256(toBytes('mud.store.storage.StoreSwitch'))

const storePrecompileAddress =
  '0x5cfe08587E1fbDc2C0e8e50ba4B5f591F45B1849' as const as Address

const precompileStateOverrideSet = {
  // app__task system
  ['0x19Be2cfAF9D0673546d67BdCb5565e0EE0feBe78']: {
    state: {
      [STORAGE_SLOT]: storePrecompileAddress,
    },
  },

  [storePrecompileAddress]: {
    code: '0x6068', // hack to bypass EXTCODESIZE check when making external calls to the store precompile
  },
} as const

export type SystemCalls = ReturnType<typeof createSystemCalls>

export function createSystemCalls(
  /*
   * The parameter list informs TypeScript that:
   *
   * - The first parameter is expected to be a
   *   SetupNetworkResult, as defined in setupNetwork.ts
   *
   *   Out of this parameter, we only care about two fields:
   *   - worldContract (which comes from getContract, see
   *     https://github.com/latticexyz/mud/blob/main/templates/react/packages/client/src/mud/setupNetwork.ts#L63-L69).
   *
   *   - waitForTransaction (which comes from syncToRecs, see
   *     https://github.com/latticexyz/mud/blob/main/templates/react/packages/client/src/mud/setupNetwork.ts#L77-L83).
   *
   * - From the second parameter, which is a ClientComponent,
   *   we only care about Counter. This parameter comes to use
   *   through createClientComponents.ts, but it originates in
   *   syncToRecs
   *   (https://github.com/latticexyz/mud/blob/main/templates/react/packages/client/src/mud/setupNetwork.ts#L77-L83).
   */
  {
    tables,
    useStore,
    worldContract,
    walletClient,
    waitForTransaction,

    memoryClient,
    storageAdapter,
  }: SetupNetworkResult,
) {
  const applyToStore = async (logs: Log[]) => {
    const parsedLogs = parseEventLogs({
      abi: storeEventsAbi,
      // @ts-ignore
      logs: logs.map((log) => {
        return {
          ...log,
          // hack until https://github.com/evmts/tevm-monorepo/pull/1482 lands
          data: removeExtraTableId(log.topics[0] as Hex)(log.data),
        }
      }),
    })

    // @ts-ignore
    await storageAdapter({ logs: parsedLogs })
  }

  const addTask = async (label: string) => {
    const tevmCallResult = await memoryClient.tevmContract({
      to: worldContract.address,
      abi: worldContract.abi,
      functionName: 'app__addTask',
      args: [label],
      from: walletClient.account.address,
      throwOnFail: false,
      stateOverrideSet: precompileStateOverrideSet,
    })

    console.log('add tevmCallResult', tevmCallResult)

    await applyToStore((tevmCallResult.logs as Log[]) ?? [])
  }

  const toggleTask = async (id: Hex) => {
    const isComplete =
      (useStore.getState().getValue(tables.Tasks, { id })?.completedAt ?? 0n) >
      0n

    const functionData = encodeFunctionData({
      abi: worldContract.abi,
      functionName: isComplete ? 'app__resetTask' : 'app__completeTask',
      args: [id],
    })

    console.log('action', isComplete ? 'app__resetTask' : 'app__completeTask')

    // TODO: figure out: state override seems to persist between calls
    // delete when https://github.com/evmts/tevm-monorepo/pull/1481 lands
    const tevmCallResult = await memoryClient.tevmCall({
      to: worldContract.address,
      data: functionData,
      from: walletClient.account.address,
      stateOverrideSet: precompileStateOverrideSet,
    })

    console.log('toggle tevmCallResult', tevmCallResult)

    await applyToStore((tevmCallResult.logs as Log[]) ?? [])
  }

  const deleteTask = async (id: Hex) => {
    const tevmCallResult = await memoryClient.tevmContract({
      to: worldContract.address,
      abi: worldContract.abi,
      functionName: 'app__deleteTask',
      args: [id],
      from: walletClient.account.address,
      throwOnFail: false,
      stateOverrideSet: precompileStateOverrideSet,
    })
    console.log('delete tevmCallResult', tevmCallResult)

    await applyToStore((tevmCallResult.logs as Log[]) ?? [])
  }

  return {
    addTask,
    toggleTask,
    deleteTask,
  }
}

const removeExtraTableId =
  (firstTopic: Hex) =>
  (data: Hex): Hex => {
    if (
      firstTopic ===
      '0x8c0b5119d4cec7b284c6b1b39252a03d1e2f2d7451a5895562524c113bb952be'
    ) {
      return removeExtraTableIdForSpliceStaticData(data)
    } else if (
      firstTopic ===
      '0x8dbb3a9672eebfd3773e72dd9c102393436816d832c7ba9e1e1ac8fcadcac7a9'
    ) {
      return removeExtraTableIdForSetRecord(data)
    } else if (
      firstTopic ===
      '0x0e1f72f429eb97e64878619984a91e687ae91610348b9ff4216782cc96e49d07'
    ) {
      return removeExtraTableIdForDeleteRecord(data)
    }
    return data
  }

function removeExtraTableIdForSpliceStaticData(data: Hex): Hex {
  // Decode the full data, including the extra tableId
  const decodedData = decodeAbiParameters(
    [
      { type: 'bytes32', name: 'tableId' },
      { type: 'bytes32[]', name: 'keyTuple' },
      { type: 'uint48', name: 'start' },
      { type: 'bytes', name: 'data' },
    ],
    data,
  )

  // Re-encode the data without the tableId
  return encodeAbiParameters(
    [
      { type: 'bytes32[]', name: 'keyTuple' },
      { type: 'uint48', name: 'start' },
      { type: 'bytes', name: 'data' },
    ],
    [decodedData[1], decodedData[2], decodedData[3]],
  )
}

function removeExtraTableIdForSetRecord(data: Hex): Hex {
  const decodedData = decodeAbiParameters(
    [
      { type: 'bytes32', name: 'tableId' },
      { type: 'bytes32[]', name: 'keyTuple' },
      { type: 'bytes', name: 'staticData' },
      { type: 'bytes32', name: 'encodedLengths' },
      { type: 'bytes', name: 'dynamicData' },
    ],
    data,
  )

  return encodeAbiParameters(
    [
      { type: 'bytes32[]', name: 'keyTuple' },
      { type: 'bytes', name: 'staticData' },
      { type: 'bytes32', name: 'encodedLengths' },
      { type: 'bytes', name: 'dynamicData' },
    ],
    [decodedData[1], decodedData[2], decodedData[3], decodedData[4]],
  )
}

function removeExtraTableIdForDeleteRecord(data: Hex): Hex {
  const decodedData = decodeAbiParameters(
    [
      { type: 'bytes32', name: 'tableId' },
      { type: 'bytes32[]', name: 'keyTuple' },
    ],
    data,
  )

  return encodeAbiParameters(
    [{ type: 'bytes32[]', name: 'keyTuple' }],
    [decodedData[1]],
  )
}
