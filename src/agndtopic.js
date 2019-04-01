import React, { Component } from 'react';

export class AgndTopic extends React.Component {
  constructor(props) {
    super(props);
  }
  
  toTime(seconds) {
    const mins = Math.floor( seconds / 60 );
    let secs = seconds % 60;
    secs = (secs < 10) ? ("0" + secs) : secs;
    return mins + ":" + secs;
  }
  
  render() {
    const name = this.props.name;
    const elapsed = this.toTime(this.props.elapsed);
    const seconds = this.toTime(this.props.seconds);
    let style = this.props.class + ' topic-item';
    
    if (this.props.elapsed > this.props.seconds && !style.match('over')) {
      style += ' over';
    }
    
    return (
      <button class={style} onClick={this.props.onClick}>
        <div>{name}</div>
        <div><span>{elapsed}</span> / <span>{seconds}</span></div>
      </button>
    );
  }
}