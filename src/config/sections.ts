import type {SettingItem, SettingsList} from '@earendil-works/pi-tui'
import {getKeybindings} from '@earendil-works/pi-tui'

import type {Focusable} from './box'

type Paint = (text: string) => string

// A header or gap has no values and no submenu, so SettingsList ignores Enter on it.
const header = (title: string, paint: Paint): SettingItem => ({
    id: `header:${title}`,
    label: paint(title.toUpperCase()),
    currentValue: ''
})

const gap = (title: string): SettingItem => ({id: `gap:${title}`, label: '', currentValue: ''})

const settable = (item: SettingItem): boolean =>
    item.values !== undefined || item.submenu !== undefined

// SettingsList steps its cursor one row at a time and cannot skip a row, so up and down are
// handled here and land on the next settable row. Keys inside an open submenu pass straight through.
const skipInert = (list: SettingsList, items: SettingItem[]): Focusable => {
    let cursor = items.findIndex(settable)
    let inSubmenu = false

    for (const item of items) {
        const open = item.submenu
        if (open === undefined) continue

        item.submenu = (current, done) => {
            inSubmenu = true
            return open(current, (value, options) => {
                inSubmenu = false
                done(value, options)
            })
        }
    }

    const move = (step: number) => {
        do cursor = (cursor + step + items.length) % items.length
        while (!settable(items[cursor] as SettingItem))
        list.selectItem((items[cursor] as SettingItem).id)
    }
    list.selectItem((items[cursor] as SettingItem).id)
    return {
        render: width => list.render(width),
        invalidate: () => list.invalidate(),
        handleInput: data => {
            const keys = getKeybindings()
            if (inSubmenu) list.handleInput(data)
            else if (keys.matches(data, 'tui.select.up')) move(-1)
            else if (keys.matches(data, 'tui.select.down')) move(1)
            else list.handleInput(data)
        }
    }
}

export {gap, header, settable, skipInert}
