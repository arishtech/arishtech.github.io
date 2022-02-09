<?php
if ( !defined( 'ABSPATH' ) ) {
    exit; // Exit if accessed directly
}
CSF::createSection( $restlyThemeOption, array(
    'title'  => esc_html__( 'General', 'restly' ),
    'icon'   => 'fa fa-cogs',
    'fields' => array(
        array(
            'id'       => 'restly_enable_preloader',
            'type'     => 'switcher',
            'default'  => true,
            'title'    => esc_html__( 'Preloader', 'restly' ),
            'subtitle' => esc_html__( 'Select Site Preloader. Default Enable', 'restly' ),
        ),
        array(
            'id'          => 'restly_preloader_color',
            'type'        => 'color',
            'title'       => esc_html__( 'Preloader color One', 'restly' ),
            'default'     => '#104cba',
            'dependency'  => array( 'restly_enable_preloader', '==', 'true' ),
            'output'      => '.loader:before',
            'output_mode' => 'border-color', // Supports css properties like ( border-color, color, background-color etc )
        ),
        array(
            'id'          => 'restly_preloader2_color',
            'type'        => 'color',
            'title'       => esc_html__( 'Preloader color Two', 'restly' ),
            'default'     => '#1d2c38',
            'dependency'  => array( 'restly_enable_preloader', '==', 'true' ),
            'output'      => '.loader:after',
            'output_mode' => 'border-color', // Supports css properties like ( border-color, color, background-color etc )
        ),
        array(
            'id'          => 'restly_preloader3_color',
            'type'        => 'color',
            'title'       => esc_html__( 'Preloader Full Width Background', 'restly' ),
            'default'     => '#ffffff',
            'dependency'  => array( 'restly_enable_preloader', '==', 'true' ),
            'output'      => '.preloader-area',
            'output_mode' => 'background-color', // Supports css properties like ( border-color, color, background-color etc )
        ),
        array(
            'id'       => 'restly_enable_page_cmt',
            'type'     => 'switcher',
            'default'  => true,
            'title'    => esc_html__( 'Enable Comment for page', 'restly' ),
            'subtitle' => esc_html__( 'Enable Comment section on Page', 'restly' ),
        ),
    ),
) );