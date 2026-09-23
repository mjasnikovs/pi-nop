import {describe, expect, mock, test} from 'bun:test'
import type {SettingItem} from '@earendil-works/pi-tui'
import {SettingsList} from '@earendil-works/pi-tui'

import {gap, header, settable, skipInert} from '../../src/config/sections'

const enter = '\r'
const up = '\x1b[A'
const down = '\x1b[B'
const escape = '\x1b'
const plain = (text: string) => text
const theme = {label: plain, value: plain, description: plain, cursor: '> ', hint: plain}

const submenu = mock((current: string, done: (value?: string) => void) => ({
    render: () => [`picking from ${current}`],
    invalidate: () => undefined,
    handleInput: (data: string) => (data === enter ? done('picked') : done())
}))

const build = () => {
    const items: SettingItem[] = [
        header('one', text => `<${text}>`),
        {id: 'a', label: 'a', currentValue: 'x', values: ['x', 'y']},
        gap('two'),
        header('two', plain),
        {id: 'b', label: 'b', currentValue: 'x', submenu}
    ]
    const onChange = mock((_id: string, _value: string) => undefined)
    const onCancel = mock(() => undefined)
    const list = new SettingsList(items, items.length, theme, onChange, onCancel)
    return {panel: skipInert(list, items), list, onChange, onCancel}
}

const selected = (lines: string[]) => lines.find(line => line.startsWith('> '))
describe('sections', () => {
    test('header is painted upper case and neither header nor gap is settable', () => {
        expect(header('tool', text => `<${text}>`)).toEqual({
            id: 'header:tool',
            label: '<TOOL>',
            currentValue: ''
        })
        expect(gap('tool')).toEqual({id: 'gap:tool', label: '', currentValue: ''})
        expect([header('t', plain), gap('t')].some(settable)).toBe(false)
    })

    test('opens on the first settable row and skips headers and gaps both ways', () => {
        const {panel} = build()
        expect(selected(panel.render(40))).toStartWith('> a')
        panel.handleInput(down)
        expect(selected(panel.render(40))).toStartWith('> b')
        panel.handleInput(down)
        expect(selected(panel.render(40))).toStartWith('> a')
        panel.handleInput(up)
        expect(selected(panel.render(40))).toStartWith('> b')
    })

    test('throws when no row is settable, so the cursor can never spin', () => {
        const items = [header('x', plain), gap('x')]
        const list = new SettingsList(
            items,
            2,
            theme,
            () => undefined,
            () => undefined
        )
        expect(() => skipInert(list, items)).toThrow(TypeError)
    })

    test('opens on row zero when it is settable and moves up without wrapping', () => {
        const items: SettingItem[] = [
            {id: 'a', label: 'a', currentValue: 'x', values: ['x']},
            header('h', plain),
            {id: 'b', label: 'b', currentValue: 'x', values: ['x']}
        ]
        const list = new SettingsList(
            items,
            3,
            theme,
            () => undefined,
            () => undefined
        )
        const panel = skipInert(list, items)
        expect(selected(panel.render(40))).toStartWith('> a')
        panel.handleInput(down)
        expect(selected(panel.render(40))).toStartWith('> b')
        panel.handleInput(up)
        expect(selected(panel.render(40))).toStartWith('> a')
    })

    test('other keys pass through to the list, so space cycles and opens too', () => {
        const {panel, onChange} = build()
        panel.handleInput(' ')
        expect(onChange).toHaveBeenCalledWith('a', 'y')
        panel.handleInput('q')
        expect(onChange).toHaveBeenCalledTimes(1)

        panel.handleInput(down)
        panel.handleInput(' ')
        expect(panel.render(40)).toEqual(['picking from x'])
        panel.handleInput(escape)
        panel.handleInput(down)
        expect(selected(panel.render(40))).toStartWith('> a')
    })

    test('invalidate reaches the list', () => {
        const {panel, list} = build()
        const invalidate = mock(() => undefined)
        list.invalidate = invalidate

        panel.invalidate()

        expect(invalidate).toHaveBeenCalledTimes(1)
    })

    test('enter and escape reach the list', () => {
        const {panel, onChange, onCancel} = build()
        panel.handleInput(enter)
        expect(onChange).toHaveBeenCalledWith('a', 'y')
        panel.handleInput(escape)
        expect(onCancel).toHaveBeenCalledTimes(1)
    })

    test('keys go to an open submenu, and the cursor stays put after it closes', () => {
        const {panel, list, onChange} = build()
        panel.handleInput(down)
        panel.handleInput(enter)
        expect(submenu).toHaveBeenCalledWith('x', expect.any(Function))
        expect(panel.render(40)).toEqual(['picking from x'])

        panel.handleInput(down)
        expect(panel.render(40)).not.toEqual(['picking from x'])
        expect(onChange).not.toHaveBeenCalled()
        expect(selected(panel.render(40))).toStartWith('> b')

        panel.handleInput(enter)
        panel.handleInput(enter)
        expect(onChange).toHaveBeenCalledWith('b', 'picked')
        expect(list.render(40)).toEqual(panel.render(40))
    })
})
