import type {Component} from '@earendil-works/pi-tui'
import {truncateToWidth, visibleWidth} from '@earendil-works/pi-tui'

type Paint = (text: string) => string
type Focusable = Component & {handleInput(data: string): void}

const edges = 4

const boxed = (child: Focusable, title: string, border: Paint, accent: Paint): Focusable => ({
    render: width => {
        const inner = width - edges
        const tag = ` ${title} `
        const top =
            border('╭─')
            + accent(tag)
            + border('─'.repeat(Math.max(0, width - 3 - visibleWidth(tag))) + '╮')
        const bottom = border('╰' + '─'.repeat(width - 2) + '╯')
        const row = (text: string) =>
            border('│ ') + truncateToWidth(text, inner, '…', true) + border(' │')

        return [top, ...['', ...child.render(inner)].map(row), bottom]
    },
    invalidate: () => child.invalidate(),
    handleInput: data => child.handleInput(data)
})

export {boxed}
export type {Focusable}
