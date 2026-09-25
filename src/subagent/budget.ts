import {estimateTokens} from '@earendil-works/pi-coding-agent'
import type {Api, Model} from '@earendil-works/pi-ai'

// MAGIC NUMBER: share of the context window the task may take. The rest is headroom for
// the system prompt, the answer and the rough 4 chars per token estimate pi uses.
const taskShare = 0.75

// pi counts 4 chars per token, which holds for ASCII only. Other scripts run near one
// token per character, and the plain estimate let CJK pages through that then overflowed.
const estimateTaskTokens = (task: string): number => {
    const nonAscii = task.match(/[\u0080-\uffff]/g)?.length ?? 0
    const base = estimateTokens({role: 'user', content: task, timestamp: Date.now()})
    return base + nonAscii - Math.floor(nonAscii / 4)
}

const fits = (task: string, model: Model<Api>): boolean =>
    estimateTaskTokens(task) <= model.contextWindow * taskShare

export {fits, taskShare}
