import { RecordData, ReplayData } from '@timecat/timecat'

const initState = {
    records: [] as RecordData[],
    packs: [] as RecordData[][],
    currentData: {} as ReplayData
}

export type ReplayDataState = typeof initState

export enum ReplayDataReducerTypes {
    UPDATE_DATA = 'UPDATE_DATA',
    APPEND_RECORDS = 'APPEND_RECORDS'
}

export function ReplayDataReducer(
    state: typeof initState,
    action: { type: ReplayDataReducerTypes; data: Partial<typeof initState> }
) {
    if (!state) {
        state = initState
    }

    if (!action) {
        return state
    }

    const { type, data } = action

    switch (type) {
        case ReplayDataReducerTypes.APPEND_RECORDS:
            const records = state.records.slice()
            records.push(...data.records!)
            return {
                ...state,
                records
            }
        case ReplayDataReducerTypes.UPDATE_DATA:
            if (data.currentData && data.currentData) {
                window.G_REPLAY_DATA = data.currentData
            }
            return {
                ...state,
                ...data
            }
        default:
            return state
    }
}