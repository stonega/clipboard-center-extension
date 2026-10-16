import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

// Match NotificationMessageGroup in GNOME Shell 51's js/ui/messageList.js.
export const EXPANSION_TIME = 200;

export const ClipboardExpanderLayout = GObject.registerClass(
    {
        Properties: {
            expansion: GObject.ParamSpec.double(
                'expansion',
                null,
                null,
                GObject.ParamFlags.READWRITE,
                0,
                1,
                0,
            ),
        },
    },
    class ClipboardCenterExpanderLayout extends Clutter.LayoutManager {
        constructor(stacked = false) {
            super();
            this._stacked = stacked;
            this._expansion = 0;
        }

        get expansion() {
            return this._expansion;
        }

        set expansion(value) {
            value = Math.max(0, Math.min(1, value));
            if (value === this._expansion) return;
            this._expansion = value;
            this.notify('expansion');
            this.layout_changed();
        }

        vfunc_get_preferred_width(container, forHeight) {
            return container
                .get_children()
                .filter((child) => child.visible)
                .reduce(
                    ([min, nat], child) => {
                        const [childMin, childNat] = child.get_preferred_width(forHeight);
                        return [Math.max(min, childMin), Math.max(nat, childNat)];
                    },
                    [0, 0],
                );
        }

        vfunc_get_preferred_height(container, forWidth) {
            const children = container.get_children().filter((child) => child.visible);
            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            const spacing = 8 * scale;
            let minExpanded = 0;
            let natExpanded = 0;
            let minCollapsed = 0;
            let natCollapsed = 0;
            children.forEach((child, index) => {
                const [min, nat] = child.get_preferred_height(forWidth);
                minExpanded += min;
                natExpanded += nat;
                if (this._stacked && index === 0) {
                    const depth = Math.min(2, children.length - 1) * 6 * scale;
                    minCollapsed = min + depth;
                    natCollapsed = nat + depth;
                }
            });
            // Controls include the gap before the cards, so it also animates.
            const gaps = Math.max(0, children.length - (this._stacked ? 1 : 0));
            minExpanded += gaps * spacing;
            natExpanded += gaps * spacing;
            return [
                minCollapsed + this._expansion * (minExpanded - minCollapsed),
                natCollapsed + this._expansion * (natExpanded - natCollapsed),
            ];
        }

        vfunc_allocate(container, box) {
            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            const width = box.get_width();
            let y = box.y1;
            let topHeight = 0;
            container
                .get_children()
                .filter((child) => child.visible)
                .forEach((child, index) => {
                    const depth = this._stacked ? Math.min(index, 2) : 0;
                    const inset = depth * 5 * scale * (1 - this._expansion);
                    const [, height] = child.get_preferred_height(Math.max(0, width - 2 * inset));
                    if (index === 0) topHeight = height;
                    const childBox = new Clutter.ActorBox();
                    childBox.x1 = box.x1 + inset;
                    childBox.x2 = box.x2 - inset;
                    childBox.y1 = this._stacked
                        ? box.y1 +
                          (topHeight + depth * 6 * scale - height) * (1 - this._expansion) +
                          (y - box.y1) * this._expansion
                        : y;
                    childBox.y2 = childBox.y1 + height;
                    child.allocate(childBox);
                    y += height + 8 * scale;
                });
        }
    },
);

export const ClipboardStack = GObject.registerClass(
    class ClipboardCenterStack extends St.Widget {
        // Like NotificationMessageGroup, paint the newest card above the stack.
        vfunc_paint(context) {
            for (const child of this.get_children().reverse()) child.paint(context);
        }

        vfunc_pick(context) {
            for (const child of this.get_children().reverse()) child.pick(context);
        }
    },
);
