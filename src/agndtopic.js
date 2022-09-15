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

    console.log('percent', prcnt)
    
    if (isOver && !style.match('over')) {
      style += ' over';
    }
    
    // return (
    //   <button 
    //     class={style} 
        // onClick={this.props.onClick} 
        // onDoubleClick={this.props.onDoubleClick}
    //     >
    //     <div>{name}</div>
    //     <div><span>{elapsed}</span> / <span>{seconds}</span></div>
    //     { !isLast ? '↓' : '' }
    //   </button>
    // );
    return (
      <>
        <Progress 
          class={style}
          type="circle" 
          strokeColor={ isOver ? 'Crimson' : prcnt > 85 ? 'YellowGreen' : 'DeepSkyBlue'}
          percent={prcnt} 
          format={() => <><div>{name}</div><div>{elapsed}</div></>} 
          onClick={this.props.onClick} 
          onDoubleClick={this.props.onDoubleClick}
        />
      </>
    )
  }
}