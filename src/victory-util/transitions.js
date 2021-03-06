/* eslint-disable func-style */
import { assign, defaults, identity } from "lodash";
import React from "react";

function getDatumKey(datum, idx) {
  return (datum.key || idx).toString();
}

function getKeyedData(data) {
  return data.reduce((keyedData, datum, idx) => {
    const key = getDatumKey(datum, idx);
    keyedData[key] = datum;
    return keyedData;
  }, {});
}

function getKeyedDataDifference(a, b) {
  let hasDifference = false;
  const difference = Object.keys(a).reduce((_difference, key) => {
    if (!(key in b)) {
      hasDifference = true;
      _difference[key] = true;
    }
    return _difference;
  }, {});
  return hasDifference && difference;
}

/**
 * Calculate which data-points exist in oldData and not nextData -
 * these are the `exiting` data-points.  Also calculate which
 * data-points exist in nextData and not oldData - these are the
 * `entering` data-points.
 *
 * @param  {Array} oldData   this.props.data Array
 * @param  {Array} nextData  this.props.data Array
 *
 * @return {Object}          Object with `entering` and `exiting` properties.
 *                           entering[datum.key] will be true if the data is
 *                           entering, and similarly for `exiting`.
 */
function getNodeTransitions(oldData, nextData) {
  const oldDataKeyed = oldData && getKeyedData(oldData);
  const nextDataKeyed = nextData && getKeyedData(nextData);

  return {
    entering: oldDataKeyed && getKeyedDataDifference(nextDataKeyed, oldDataKeyed),
    exiting: nextDataKeyed && getKeyedDataDifference(oldDataKeyed, nextDataKeyed)
  };
}

function getChildData(child) {
  if (child.type && child.type.getData) {
    return child.type.getData(child.props);
  }
  return child.props && child.props.data || false;
}

/**
 * If a parent component has animation enabled, calculate the transitions
 * for any data of any child component that supports data transitions
 * Data transitions are defined as any two datasets where data nodes exist
 * in the first set and not the second, in the second and not the first,
 * or both.
 *
 * @param  {Children}  oldChildren   this.props.children from old props
 * @param  {Children}  nextChildren  this.props.children from next props
 *
 * @return {Object}                  Object with the following properties:
 *                                    - nodesWillExit
 *                                    - nodesWillEnter
 *                                    - childrenTransitions
 *                                    - nodesShouldEnter
 *                                    - nodesDoneClipPathEnter
 *                                    - nodesDoneClipPathExit
 */
export function getInitialTransitionState(oldChildren, nextChildren) {
  let nodesWillExit = false;
  let nodesWillEnter = false;

  const getTransition = (oldChild, newChild) => {
    if (!newChild || oldChild.type !== newChild.type) {
      return {};
    }

    const { entering, exiting } =
      getNodeTransitions(getChildData(oldChild), getChildData(newChild)) || {};

    nodesWillExit = nodesWillExit || !!exiting;
    nodesWillEnter = nodesWillEnter || !!entering;

    return { entering: entering || false, exiting: exiting || false };
  };

  const getTransitionsFromChildren = (old, next) => {
    return old.map((child, idx) => {
      if (child && child.props && child.props.children) {
        return getTransitionsFromChildren(
          React.Children.toArray(old[idx].props.children),
          React.Children.toArray(next[idx].props.children)
        );
      }
      // get Transition entering and exiting nodes
      return getTransition(child, next[idx]);
    });
  };

  const childrenTransitions = getTransitionsFromChildren(
    React.Children.toArray(oldChildren),
    React.Children.toArray(nextChildren)
  );
  return {
    nodesWillExit,
    nodesWillEnter,
    childrenTransitions,
    // TODO: This may need to be refactored for the following situation.
    //       The component receives new props, and the data provided
    //       is a perfect match for the previous data and domain except
    //       for new nodes. In this case, we wouldn't want a delay before
    //       the new nodes appear.
    nodesShouldEnter: false,
    nodesDoneClipPathEnter: false,
    nodesDoneClipPathExit: false
  };
}

function getInitialChildProps(animate, data) {
  const after = animate.onEnter && animate.onEnter.after ? animate.onEnter.after : identity;
  return {
    data: data.map((datum) => assign({}, datum, after(datum)))
  };
}

function getChildClipPathToExit(animate, child, data, exitingNodes, cb) { // eslint-disable-line max-params, max-len
  let clipWidth;

  if (exitingNodes) {
    animate = assign({}, animate, { onEnd: cb });
    const beforeClipPathWidth = animate.onExit && animate.onExit.beforeClipPathWidth;

    if (beforeClipPathWidth) {
      clipWidth = beforeClipPathWidth(data, child, exitingNodes);
      return { animate, clipWidth };
    }
  }

  return { animate };
}

function getChildPropsOnExit(animate, child, data, exitingNodes, cb) { // eslint-disable-line max-params, max-len
  // Whether or not _this_ child has exiting nodes, we want the exit-
  // transition for all children to have the same duration, delay, etc.
  const onExit = animate && animate.onExit;
  animate = assign({}, animate, onExit);

  if (exitingNodes) {
    // After the exit transition occurs, trigger the animations for
    // nodes that are neither exiting or entering.
    animate.onEnd = cb;
    const before = animate.onExit && animate.onExit.before ? animate.onExit.before : identity;
    // If nodes need to exit, transform them with the provided onExit.before function.
    data = data.map((datum, idx) => {
      const key = (datum.key || idx).toString();
      return exitingNodes[key] ? assign({}, datum, before(datum)) : datum;
    });
  }

  return { animate, data };
}

function getChildClipPathToEnter(animate, child, data, enteringNodes, cb) { // eslint-disable-line max-params, max-len
  let clipWidth;

  if (enteringNodes) {
    animate = assign({}, animate, { onEnd: cb });
    const afterClipPathWidth = animate.onEnter && animate.onEnter.afterClipPathWidth;

    if (afterClipPathWidth) {
      clipWidth = afterClipPathWidth(data, child);
      return { animate, clipWidth};
    }
  }

  return { animate };
}

function getChildPropsBeforeEnter(animate, child, data, enteringNodes, cb) { // eslint-disable-line max-params,max-len
  let clipWidth;

  if (enteringNodes) {
    // Perform a normal animation here, except - when it finishes - trigger
    // the transition for entering nodes.
    animate = assign({}, animate, { onEnd: cb });
    const before = animate.onEnter && animate.onEnter.before ? animate.onEnter.before : identity;
    const beforeClipPathWidth = animate.onEnter && animate.onEnter.beforeClipPathWidth;
    // We want the entering nodes to be included in the transition target
    // domain.  However, we may not want these nodes to be displayed initially,
    // so perform the `onEnter.before` transformation on each node.
    data = data.map((datum, idx) => {
      const key = (datum.key || idx).toString();
      return enteringNodes[key] ? assign({}, datum, before(datum)) : datum;
    });

    if (beforeClipPathWidth) {
      clipWidth = beforeClipPathWidth(data, child, enteringNodes);
      return { animate, data, clipWidth};
    }
  }

  return { animate, data };
}

function getChildPropsOnEnter(animate, child, data, enteringNodes) { // eslint-disable-line max-params, max-len
  // Whether or not _this_ child has entering nodes, we want the entering-
  // transition for all children to have the same duration, delay, etc.
  const onEnter = animate && animate.onEnter;
  animate = assign({}, animate, onEnter);

  if (enteringNodes) {
    // Old nodes have been transitioned to their new values, and the
    // domain should encompass the nodes that will now enter. So perform
    // the `onEnter.after` transformation on each node.
    const after = animate.onEnter && animate.onEnter.after ? animate.onEnter.after : identity;
    data = data.map((datum, idx) => {
      const key = getDatumKey(datum, idx);
      return enteringNodes[key] ? assign({}, datum, after(datum)) : datum;
    });
  }
  return { animate, data };
}

/**
 * getTransitionPropsFactory - putting the Java in JavaScript.  This will return a
 * function that returns prop transformations for a child, given that child's props
 * and its index in the parent's children array.
 *
 * In particular, this will include an `animate` object that is set appropriately
 * so that each child will be synchoronized for each stage of a transition
 * animation.  It will also include a transformed `data` object, where each datum
 * is transformed by `animate.onExit` and `animate.onEnter` `before` and `after`
 * functions.
 *
 * @param  {Object}  props       `this.props` for the parent component.
 * @param  {Object} state        `this.state` for the parent component.
 * @param  {Function} setState    Function that, when called, will `this.setState` on
 *                                 the parent component with the provided object.
 *
 * @return {Function}              Child-prop transformation function.
 */
export function getTransitionPropsFactory(props, state, setState) {
  const nodesWillExit = state && state.nodesWillExit;
  const nodesWillEnter = state && state.nodesWillEnter;
  const nodesShouldEnter = state && state.nodesShouldEnter;
  const nodesDoneClipPathEnter = state && state.nodesDoneClipPathEnter;
  const nodesDoneClipPathExit = state && state.nodesDoneClipPathExit;
  const childrenTransitions = state && state.childrenTransitions || [];
  const transitionDurations = {
    enter: props.animate && props.animate.onEnter && props.animate.onEnter.duration,
    exit: props.animate && props.animate.onExit && props.animate.onExit.duration,
    move: props.animate && props.animate.duration
  };

  const onExit = (nodes, child, data, animate) => { // eslint-disable-line max-params
    if (!nodesDoneClipPathExit) {
      return getChildClipPathToExit(animate, child, data, nodes, () => {
        setState({ nodesDoneClipPathExit: true });
      });
    }

    return getChildPropsOnExit(animate, child, data, nodes, () => {
      setState({ nodesWillExit: false });
    });
  };

  const onEnter = (nodes, child, data, animate) => { // eslint-disable-line max-params
    if (nodesShouldEnter) {
      if (!nodesDoneClipPathEnter) {
        return getChildClipPathToEnter(animate, child, data, nodes, () => {
          setState({ nodesDoneClipPathEnter: true });
        });
      }

      return getChildPropsOnEnter(animate, child, data, nodes);
    }

    return getChildPropsBeforeEnter(animate, child, data, nodes, () => {
      setState({ nodesShouldEnter: true });
    });
  };

  const getChildTransitionDuration = function (child, type) {
    const animate = child.props.animate;
    const defaultTransitions = child.type && child.type.defaultTransitions;
    return animate[type] && animate[type].duration ||
      defaultTransitions[type] && defaultTransitions[type].duration;
  };

  return function getTransitionProps(child, index) { // eslint-disable-line max-statements
    const data = getChildData(child) || [];
    const animate = defaults({}, props.animate, child.props.animate);

    animate.onExit = defaults(
      {}, animate.onExit, child.type.defaultTransitions && child.type.defaultTransitions.onExit
    );
    animate.onEnter = defaults(
      {}, animate.onEnter, child.type.defaultTransitions && child.type.defaultTransitions.onEnter
    );

    const childTransitions = childrenTransitions[index] || childrenTransitions[0];
    if (nodesWillExit) {
      const exitingNodes = childTransitions && childTransitions.exiting;
      const exit = transitionDurations.exit || getChildTransitionDuration(child, "onExit");
      // if nodesWillExit, but this child has no exiting nodes, set a delay instead of a duration
      const animation = exitingNodes ? {duration: exit} : {delay: exit};
      return onExit(exitingNodes, child, data, assign({}, animate, animation));
    } else if (nodesWillEnter) {
      const enteringNodes = childTransitions && childTransitions.entering;
      const enter = transitionDurations.enter || getChildTransitionDuration(child, "onEnter");
      const move = transitionDurations.move ||
        child.props.animate && child.props.animate.duration;
      const animation = { duration: nodesShouldEnter && enteringNodes ? enter : move };
      return onEnter(enteringNodes, child, data, assign({}, animate, animation));
    } else if (!state && animate && animate.onExit) {
      // This is the initial render, and nodes may enter when props change. Because
      // animation interpolation is determined by old- and next- props, data may need
      // to be augmented with certain properties.
      //
      // For example, it may be desired that exiting nodes go from `opacity: 1` to
      // `opacity: 0`. Without setting this on a per-datum basis, the interpolation
      // might go from `opacity: undefined` to `opacity: 0`, which would result in
      // interpolated `opacity: NaN` values.
      //
      return getInitialChildProps(animate, data);
    }
    return { animate, data };

  };
}
