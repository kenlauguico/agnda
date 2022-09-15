import React, { Component } from 'react';
import { Progress } from 'antd';

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
    const isLast = this.props.isLast;
    const prcnt = (this.props.elapsed / this.props.seconds)*100;
    const isOver = this.props.elapsed > this.props.seconds;
    
    let style = this.props.class + ' topic-item';
    
    if (isOver && !style.match('over')) {
      style += ' over';
    }
    
    return (
      <>
        <Progress 
          class={style}
          type="circle"
          width={200}
          strokeColor={ isOver ? 'Crimson' : prcnt > 85 ? 'YellowGreen' : 'DeepSkyBlue'}
          percent={prcnt} 
          format={() => <><div style={{fontSize: 'medium', padding: '0 1em'}}>{name}</div><div>{elapsed}</div></>} 
          onClick={this.props.onClick} 
          onDoubleClick={this.props.onDoubleClick}
        />
      </>
    )
  }
}