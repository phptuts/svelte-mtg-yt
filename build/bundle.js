var app = (function () {
    'use strict';

    function noop() { }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.data !== data)
            text.data = data;
    }
    function set_style(node, key, value, important) {
        node.style.setProperty(key, value, important ? 'important' : '');
    }
    function custom_event(type, detail) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, false, false, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error(`Function called outside component initialization`);
        return current_component;
    }
    function createEventDispatcher() {
        const component = get_current_component();
        return (type, detail) => {
            const callbacks = component.$$.callbacks[type];
            if (callbacks) {
                // TODO are there situations where events could be dispatched
                // in a server (non-DOM) environment?
                const event = custom_event(type, detail);
                callbacks.slice().forEach(fn => {
                    fn.call(component, event);
                });
            }
        };
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const prop_values = options.props || {};
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, prop_values, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if ($$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(children(options.target));
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set() {
            // overridden by instance, if it has props
        }
    }

    /* src/Player.svelte generated by Svelte v3.18.2 */

    function create_if_block(ctx) {
    	let h2;
    	let t;

    	return {
    		c() {
    			h2 = element("h2");
    			t = text(/*winningText*/ ctx[1]);
    		},
    		m(target, anchor) {
    			insert(target, h2, anchor);
    			append(h2, t);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*winningText*/ 2) set_data(t, /*winningText*/ ctx[1]);
    		},
    		d(detaching) {
    			if (detaching) detach(h2);
    		}
    	};
    }

    function create_fragment(ctx) {
    	let div;
    	let h2;
    	let t0;
    	let t1;
    	let button0;
    	let t2;
    	let t3;
    	let button1;
    	let t4;
    	let t5;
    	let dispose;
    	let if_block = /*won*/ ctx[2] && create_if_block(ctx);

    	return {
    		c() {
    			div = element("div");
    			h2 = element("h2");
    			t0 = text(/*score*/ ctx[0]);
    			t1 = space();
    			button0 = element("button");
    			t2 = text("+");
    			t3 = space();
    			button1 = element("button");
    			t4 = text("-");
    			t5 = space();
    			if (if_block) if_block.c();
    			button0.disabled = /*gameOver*/ ctx[4];
    			attr(button0, "class", "plus svelte-7xkkoo");
    			button1.disabled = /*gameOver*/ ctx[4];
    			attr(button1, "class", "minus svelte-7xkkoo");
    			set_style(div, "color", /*fontColor*/ ctx[3]);
    			attr(div, "class", "player svelte-7xkkoo");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, h2);
    			append(h2, t0);
    			append(div, t1);
    			append(div, button0);
    			append(button0, t2);
    			append(div, t3);
    			append(div, button1);
    			append(button1, t4);
    			append(div, t5);
    			if (if_block) if_block.m(div, null);

    			dispose = [
    				listen(button0, "click", /*plus*/ ctx[6]),
    				listen(button1, "click", /*minus*/ ctx[5])
    			];
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*score*/ 1) set_data(t0, /*score*/ ctx[0]);

    			if (dirty & /*gameOver*/ 16) {
    				button0.disabled = /*gameOver*/ ctx[4];
    			}

    			if (dirty & /*gameOver*/ 16) {
    				button1.disabled = /*gameOver*/ ctx[4];
    			}

    			if (/*won*/ ctx[2]) {
    				if (if_block) {
    					if_block.p(ctx, dirty);
    				} else {
    					if_block = create_if_block(ctx);
    					if_block.c();
    					if_block.m(div, null);
    				}
    			} else if (if_block) {
    				if_block.d(1);
    				if_block = null;
    			}

    			if (dirty & /*fontColor*/ 8) {
    				set_style(div, "color", /*fontColor*/ ctx[3]);
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div);
    			if (if_block) if_block.d();
    			run_all(dispose);
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	let { score } = $$props;
    	let { winningText } = $$props;
    	let { won } = $$props;
    	let { fontColor } = $$props;
    	let { gameOver = false } = $$props;
    	const dispatch = createEventDispatcher();

    	function minus() {
    		dispatch("points", -1);
    	}

    	function plus() {
    		dispatch("points", 1);
    	}

    	$$self.$set = $$props => {
    		if ("score" in $$props) $$invalidate(0, score = $$props.score);
    		if ("winningText" in $$props) $$invalidate(1, winningText = $$props.winningText);
    		if ("won" in $$props) $$invalidate(2, won = $$props.won);
    		if ("fontColor" in $$props) $$invalidate(3, fontColor = $$props.fontColor);
    		if ("gameOver" in $$props) $$invalidate(4, gameOver = $$props.gameOver);
    	};

    	return [score, winningText, won, fontColor, gameOver, minus, plus];
    }

    class Player extends SvelteComponent {
    	constructor(options) {
    		super();

    		init(this, options, instance, create_fragment, safe_not_equal, {
    			score: 0,
    			winningText: 1,
    			won: 2,
    			fontColor: 3,
    			gameOver: 4
    		});
    	}
    }

    /* src/App.svelte generated by Svelte v3.18.2 */

    function create_fragment$1(ctx) {
    	let main;
    	let h1;
    	let t1;
    	let div;
    	let t2;
    	let t3;
    	let button;
    	let current;
    	let dispose;

    	const player0 = new Player({
    			props: {
    				gameOver: /*gameOver*/ ctx[4],
    				fontColor: "#0000AA",
    				won: /*blueWon*/ ctx[2],
    				winningText: "Blue wins",
    				score: /*blueScore*/ ctx[1]
    			}
    		});

    	player0.$on("points", /*updateBlueScore*/ ctx[5]);

    	const player1 = new Player({
    			props: {
    				gameOver: /*gameOver*/ ctx[4],
    				fontColor: "#AA0000",
    				won: /*redWon*/ ctx[3],
    				winningText: "Red Wins",
    				score: /*redScore*/ ctx[0]
    			}
    		});

    	player1.$on("points", /*updateRedScore*/ ctx[6]);

    	return {
    		c() {
    			main = element("main");
    			h1 = element("h1");
    			h1.textContent = "Magic The Gathering Counter";
    			t1 = space();
    			div = element("div");
    			create_component(player0.$$.fragment);
    			t2 = space();
    			create_component(player1.$$.fragment);
    			t3 = space();
    			button = element("button");
    			button.textContent = "Start Game";
    			attr(div, "id", "controls-container");
    			attr(div, "class", "svelte-1h52mth");
    			attr(button, "class", "svelte-1h52mth");
    			attr(main, "class", "svelte-1h52mth");
    		},
    		m(target, anchor) {
    			insert(target, main, anchor);
    			append(main, h1);
    			append(main, t1);
    			append(main, div);
    			mount_component(player0, div, null);
    			append(div, t2);
    			mount_component(player1, div, null);
    			append(main, t3);
    			append(main, button);
    			current = true;
    			dispose = listen(button, "click", /*newGame*/ ctx[7]);
    		},
    		p(ctx, [dirty]) {
    			const player0_changes = {};
    			if (dirty & /*gameOver*/ 16) player0_changes.gameOver = /*gameOver*/ ctx[4];
    			if (dirty & /*blueWon*/ 4) player0_changes.won = /*blueWon*/ ctx[2];
    			if (dirty & /*blueScore*/ 2) player0_changes.score = /*blueScore*/ ctx[1];
    			player0.$set(player0_changes);
    			const player1_changes = {};
    			if (dirty & /*gameOver*/ 16) player1_changes.gameOver = /*gameOver*/ ctx[4];
    			if (dirty & /*redWon*/ 8) player1_changes.won = /*redWon*/ ctx[3];
    			if (dirty & /*redScore*/ 1) player1_changes.score = /*redScore*/ ctx[0];
    			player1.$set(player1_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(player0.$$.fragment, local);
    			transition_in(player1.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(player0.$$.fragment, local);
    			transition_out(player1.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(main);
    			destroy_component(player0);
    			destroy_component(player1);
    			dispose();
    		}
    	};
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let redScore = 20;
    	let blueScore = 20;

    	function updateBlueScore(e) {
    		const updateScore = e.detail;
    		$$invalidate(1, blueScore += updateScore);
    	}

    	function updateRedScore(e) {
    		const updateScore = e.detail;
    		$$invalidate(0, redScore += updateScore);
    	}

    	function newGame() {
    		$$invalidate(0, redScore = 20);
    		$$invalidate(1, blueScore = 20);
    	}

    	let blueWon;
    	let redWon;
    	let gameOver;

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*redScore*/ 1) {
    			 $$invalidate(2, blueWon = redScore <= 0);
    		}

    		if ($$self.$$.dirty & /*blueScore*/ 2) {
    			 $$invalidate(3, redWon = blueScore <= 0);
    		}

    		if ($$self.$$.dirty & /*blueWon, redWon*/ 12) {
    			 $$invalidate(4, gameOver = blueWon || redWon);
    		}
    	};

    	return [
    		redScore,
    		blueScore,
    		blueWon,
    		redWon,
    		gameOver,
    		updateBlueScore,
    		updateRedScore,
    		newGame
    	];
    }

    class App extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, {});
    	}
    }

    const app = new App({
      target: document.body
    });

    return app;

}());
//# sourceMappingURL=bundle.js.map
