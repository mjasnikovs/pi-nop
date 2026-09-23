import {describe, expect, mock, test} from 'bun:test'

import {boxed} from '../../src/config/box'

const wrap = (text: string) => `<${text}>`
const child = {
    render: mock((_width: number) => ['abc', '\x1b[31mred\x1b[0m', 'this line is far too long']),
    invalidate: mock(() => undefined),
    handleInput: mock((_data: string) => undefined)
}
describe('boxed', () => {
    test('frames the child at the inner width with the title in the top edge', () => {
        const lines = boxed(child, 'pi-nop', wrap, str => `[${str}]`).render(20)
        expect(child.render).toHaveBeenCalledWith(16)
        expect(lines).toEqual([
            '<╭─>[ pi-nop ]<─────────╮>',
            '<│ >' + ' '.repeat(16) + '< │>',
            '<│ >abc             < │>',
            '<│ >\x1b[31mred\x1b[0m             < │>',
            '<│ >this line is fa\x1b[0m…\x1b[0m< │>',
            '<╰──────────────────╯>'
        ])
    })

    test('an empty child still gets the blank row', () => {
        const empty = {render: () => [], invalidate: () => undefined, handleInput: () => undefined}
        expect(boxed(empty, 't', wrap, wrap).render(8)).toEqual([
            '<╭─><[ t ]><──╮>'.replace('[ t ]', ' t '),
            '<│ >    < │>',
            '<╰──────╯>'
        ])
    })

    test('a title wider than the box keeps the top line, and a box under two columns throws', () => {
        const top = boxed(child, 'a long title', wrap, wrap).render(8)[0]
        expect(top).toBe('<╭─>< a long title ><╮>')
        expect(() => boxed(child, 't', wrap, wrap).render(1)).toThrow(RangeError)
    })

    test('forwards invalidate and input to the child', () => {
        const box = boxed(child, 'pi-nop', wrap, wrap)
        box.invalidate()
        box.handleInput('x')

        expect(child.invalidate).toHaveBeenCalledTimes(1)
        expect(child.handleInput).toHaveBeenCalledWith('x')
    })
})
